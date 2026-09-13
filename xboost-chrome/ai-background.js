/* global browser */
'use strict'

;(function () {
  const KEY = 'xboost:ai'
  const SESSION = 'xboost:discovery-session'
  const discovery = globalThis.XboostDiscovery
  const JobRepository = globalThis.XboostJobRepository.JobRepository
  let session = null
  let runEpoch = 0
  let activeJob
  let catalogCache
  const panels = new Set()
  const handoffs = new Map()
  browser.tabs.onRemoved.addListener(id => {
    handoffs.delete(id)
    if (session?.tabs.some(tab => tab.id === id)) {
      session.tabs = session.tabs.filter(tab => tab.id !== id)
      persist().catch(() => {})
    }
  })
  browser.tabs.onActivated?.addListener(info => {
    syncProfileForTab(info.tabId).catch(error => { lastError = error.message })
  })
  let config = { url: '', token: '' }
  let jobs = []
  const jobById = new Map()
  const jobPositions = new Map()
  const repliesByPost = new Map()
  let repository
  let enabled = false
  let lastError = ''
  let client
  let target
  let controller
  let working = false
  let saving = Promise.resolve()
  let scheduledSmallState = ''
  let queueRevision = 0
  let sessionRevision = 0
  let queueNotificationTimer
  let connectionCache
  let connectionStatusPromise
  const initialized = browser.storage.local.get([KEY, SESSION]).then(async data => {
    config = data[KEY] || config
    session = data[SESSION] || null
    scheduledSmallState = JSON.stringify({ [KEY]: config, [SESSION]: session })
    repository = new JobRepository(browser)
    jobs = await repository.init(discovery?.normalize || (value => String(value || '').trim()), session?.id)
    jobs.forEach((job, index) => {
      jobById.set(job.id, job)
      jobPositions.set(job.id, index)
      indexReply(job)
    })
    if (session) discovery.upgrade(session)
    if (session?.profiles?.length > 1) {
      session.status = 'stopped'
      session.reason = 'The previous multi-profile session was ended after upgrading. Its drafts are preserved. Start a new single-profile session.'
      session.epoch++
    }
    if (session && !['stopped', 'complete'].includes(session.status)) {
      session.status = 'paused'
      session.reason = 'Extension restarted. Resume explicitly; searches are never opened automatically.'
      session.epoch++
    }
    for (const header of jobs.filter(job => job.status === 'running')) {
      const job = await repository.get(header.id)
      job.status = 'interrupted'
      job.error = 'Extension restarted; not retried automatically'
      await saveJob(job)
    }
    return persist()
  })
  function upsertHeader (header) {
    const previous = jobById.get(header.id)
    let index = jobPositions.get(header.id)
    // Discovery policy appends accepted candidates before their durable write.
    // Resolve that one new slot without turning normal updates into full scans.
    if (index === undefined) {
      const discovered = jobs.findIndex(job => job.id === header.id)
      if (discovered >= 0) index = discovered
    }
    if (index !== undefined) jobs[index] = header
    else {
      jobPositions.set(header.id, jobs.length)
      jobs.push(header)
    }
    jobPositions.set(header.id, index === undefined ? jobs.length - 1 : index)
    jobById.set(header.id, header)
    indexReply(header, previous)
  }
  function indexReply (header, previous) {
    if (previous?.repliedAt) {
      const ids = repliesByPost.get(previous.post?.id)
      ids?.delete(previous.id)
      if (ids && !ids.size) repliesByPost.delete(previous.post?.id)
    }
    if (!header?.repliedAt || !header.post?.id) return
    if (!repliesByPost.has(header.post.id)) repliesByPost.set(header.post.id, new Set())
    repliesByPost.get(header.post.id).add(header.id)
  }
  async function saveJob (job) {
    const header = await repository.put(job)
    upsertHeader(header)
    discovery?.invalidate(jobs)
    queueRevision++
    if (queueNotificationTimer === undefined) {
      queueNotificationTimer = setTimeout(() => {
        queueNotificationTimer = undefined
        for (const panel of panels) panel.postMessage?.({ type: 'queue-revision', revision: queueRevision })
      }, 40)
    }
    return header
  }
  async function rememberSnapshot (revision, account) {
    await repository.putSnapshot(revision, account)
  }
  async function activateSessionIndex (sessionId) {
    for (const job of jobs) {
      delete job.normalizedPost
      delete job.normalizedDraft
    }
    for (const header of await repository.setActiveSession(sessionId)) upsertHeader(header)
  }
  async function accountForJob (job) {
    return await repository.getSnapshot(job.profileRevision) || session?.profiles.find(profile => profile.id === job.profileId && profile.revision === job.profileRevision)?.account || job.accountSnapshot
  }
  function persist () {
    if (session?.status === 'running' && session.profiles.every(profile => !profile.blocked && discovery.counts(session, profile, jobs).ready >= session.target)) {
      session.status = 'complete'
      session.reason = 'The selected profile reached its ready-draft target. Start a new session to top up or work on another profile.'
      enabled = false
      runEpoch++
    }
    const serialized = JSON.stringify({ [KEY]: { ...config, enabled: false }, [SESSION]: session })
    if (serialized === scheduledSmallState) return saving
    scheduledSmallState = serialized
    const snapshot = JSON.parse(serialized)
    saving = saving.catch(() => {}).then(async () => {
      await browser.storage.local.set(snapshot)
      sessionRevision++
      for (const panel of panels) panel.postMessage?.({ type: 'session-revision', revision: sessionRevision })
    }).catch(error => {
      if (scheduledSmallState === serialized) scheduledSmallState = ''
      throw error
    })
    return saving
  }
  function pause (reason = 'Paused. Your drafts and discovery progress are preserved.') {
    enabled = false
    runEpoch++
    controller?.abort()
    if (session?.status === 'running') { session.status = 'paused'; session.reason = reason; session.epoch++ }
    persist().catch(() => {})
  }
  async function stopWorker (reason) {
    pause(reason)
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!working) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    if (working) throw new Error('The current draft is still stopping. Try again in a moment.')
  }
  async function profiles () {
    await globalThis.XboostCore.loadSettings()
    const state = (await browser.storage.local.get('xboost:profiles'))['xboost:profiles']
    const signature = JSON.stringify({ profiles: state.profiles, details: state.details })
    if (catalogCache?.signature !== signature) {
      catalogCache = {
        signature,
        promise: discovery.catalog(globalThis.XboostCore, state, globalThis.XboostReplies.ACCOUNTS, async path => {
          const response = await fetch(browser.runtime.getURL(path))
          if (!response.ok) throw new Error('Product context unavailable')
          return response.text()
        })
      }
    }
    return catalogCache.promise
  }
  async function ownedHandles () {
    return new Set([...Object.values(globalThis.XboostReplies.ACCOUNTS).map(item => item.handle), ...session.profiles.map(item => item.account.handle), ...(await profiles()).map(item => item.account.handle)].map(handle => handle.toLowerCase()))
  }
  async function checkProfiles () {
    if (!session || ['stopped', 'complete'].includes(session.status)) return false
    const current = await profiles()
    let changed = false
    for (const profile of session.profiles) {
      if (current.find(item => item.id === profile.id)?.revision !== profile.revision) {
        const reason = 'Profile changed. Accept current settings to continue; old drafts are retained separately.'
        if (profile.blocked !== reason) { profile.blocked = reason; changed = true }
        if (activeJob?.profileId === profile.id) controller?.abort()
      }
    }
    return changed
  }
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes['xboost:profiles'] || !session) return
    if (changes['xboost:profiles'].newValue?.enabled === false) pause('Xboost scoring was paused. Re-enable it before resuming discovery.')
    checkProfiles().then(changed => changed && persist()).catch(error => pause(error.message))
  })
  function sameSearch (expected, actual) {
    try {
      const left = new URL(expected)
      const right = new URL(actual)
      const host = value => value.hostname.replace(/^www\./, '')
      return ['x.com', 'twitter.com'].includes(host(right)) && right.pathname === '/search' &&
        left.searchParams.get('q') === right.searchParams.get('q') &&
        (left.searchParams.get('f') || 'top') === (right.searchParams.get('f') || 'top')
    } catch { return false }
  }
  function binding (sender) {
    if (!sender.tab || sender.tab.incognito || sender.frameId !== 0) return null
    return session?.tabs.find(tab => tab.id === sender.tab.id && sameSearch(tab.url, sender.url))
  }
  async function syncProfileForTab (tabId) {
    const record = session?.tabs.find(tab => tab.id === tabId)
    if (!record || !globalThis.xboostProfileCommand) return false
    const current = await globalThis.XboostCore.loadSettings()
    if (current.profileId !== record.profileId) await globalThis.xboostProfileCommand({ action: 'switch', profileId: record.profileId })
    return true
  }
  function decorateJob (job, replyRecords) {
    let eligibility = ''
    if (session) {
      const profile = session.profiles.find(profile => profile.id === job.profileId)
      eligibility = ['ready', 'queued', 'interrupted'].includes(job.status) && profile && !discovery.compatible(job, session, profile, Date.now()) ? 'Not counted: older profile revision, stale post or unknown source age' : ''
    }
    return { ...job, discoveryEligibility: eligibility, replyRecords }
  }
  async function jobView (request = {}) {
    const page = await repository.page({ ...request, pageSize: 25 })
    const edits = new Map((await repository.getEdits(page.jobs.map(job => job.id))).map(edit => [edit.jobId, edit]))
    const postIds = new Set(page.jobs.map(job => job.post.id))
    const replyIds = [...postIds].flatMap(postId => [...(repliesByPost.get(postId) || [])])
    const replyJobs = await Promise.all(replyIds.map(id => repository.get(id)))
    const records = new Map()
    for (const job of replyJobs) {
      if (!records.has(job.post.id)) records.set(job.post.id, [])
      records.get(job.post.id).push({ expectedHandle: job.expectedHandle, repliedAt: job.repliedAt })
    }
    page.jobs = page.jobs.map(job => ({ ...decorateJob(job, records.get(job.post.id) || []), localEdit: edits.get(job.id) }))
    return page
  }
  async function enableForSession () {
    if (!panels.size) throw new Error('Keep the AI panel open')
    if (!(await globalThis.XboostCore.loadSettings()).enabled) throw new Error('Enable Xboost scoring before starting or resuming discovery')
    if (working && !enabled) throw new Error('Wait for the interrupted draft to stop')
    const epoch = runEpoch
    const { account } = await connection().call('account/read', { refreshToken: false })
    if (!account) throw new Error('Sign in to Codex in Settings first')
    if (!panels.size || epoch !== runEpoch) throw new Error('Discovery was paused while connecting')
  }
  async function openNextSearch (active) {
    const previousCursor = session.cursor
    const previousProfiles = session.profiles.map(profile => ({ cursor: profile.cursor, exhausted: profile.exhausted, nextRetryAt: profile.nextRetryAt, currentSearch: profile.currentSearch, currentFallback: profile.currentFallback, visits: { ...profile.visits } }))
    const selection = discovery.chooseSearch(session, jobs)
    const epoch = runEpoch
    const url = 'https://x.com/search?' + new URLSearchParams({ q: selection.query.query, f: selection.query.mode || 'live', src: 'typed_query' })
    let record = session.tabs.find(tab => tab.profileId === selection.profile.id)
    const oldRecord = record && { ...record }
    try {
      if (!record) {
        const tab = await browser.tabs.create({ url: 'about:blank', active })
        if (epoch !== runEpoch || session.status !== 'running') throw new Error('Opening search cancelled; the blank tab was left untouched')
        record = { id: tab.id, url, profileId: selection.profile.id, revision: selection.profile.revision }
        session.tabs.push(record)
      } else Object.assign(record, { url, revision: selection.profile.revision })
      await persist()
      if (epoch !== runEpoch || !enabled) throw new Error('Opening search cancelled')
      await browser.tabs.update(record.id, { url, active })
      if (active) await syncProfileForTab(record.id)
      return selection
    } catch (error) {
      session.cursor = previousCursor
      session.profiles.forEach((profile, index) => Object.assign(profile, previousProfiles[index]))
      if (oldRecord && record) Object.assign(record, oldRecord)
      else if (record) session.tabs = session.tabs.filter(tab => tab !== record)
      session.reason = 'Search could not open: ' + error.message
      await persist()
      throw error
    }
  }
  async function sessionAction (message, sender) {
    if (message.action === 'session-context' || message.action === 'session-batch') {
      if (sender.tab && session?.tabs.some(tab => tab.id === sender.tab.id) && /^https:\/\/(www\.)?(x|twitter)\.com\/(?:account\/access|i\/flow\/login|login)(?:[/?#]|$)/.test(sender.url || '')) pause('X requires sign-in or an access check. Resolve it on X before resuming. No automatic retry.')
      const tab = binding(sender)
      if (!tab) return { bound: false }
      const profile = session.profiles.find(item => item.id === tab.profileId)
      if (message.action === 'session-context') return { bound: true, profileId: profile.id, name: profile.name, settings: profile.settings, epoch: session.epoch, active: enabled && session.status === 'running' && !profile.blocked && tab.revision === profile.revision }
      if (!enabled || session.status !== 'running' || message.epoch !== session.epoch || tab.revision !== profile.revision) return { ignored: true }
      const epoch = runEpoch
      await checkProfiles()
      if (epoch !== runEpoch || !enabled || session.status !== 'running' || profile.blocked) return { ignored: true }
      if (!Array.isArray(message.features) || message.features.length > 50) throw new Error('Invalid discovery batch')
      const owned = await ownedHandles()
      if (epoch !== runEpoch || !enabled || session.status !== 'running' || profile.blocked) return { ignored: true }
      const before = jobs.length
      const results = message.features.map(features => discovery.accept(session, profile, features, jobs, globalThis.XboostCore, owned))
      for (const job of jobs.slice(before)) await saveJob(job)
      discovery.invalidate(jobs)
      await persist()
      work().catch(error => pause(error.message))
      return { results }
    }
    if (sender.url !== browser.runtime.getURL('ai.html')) throw new Error('AI panel required')
    if (message.action === 'session-catalog') {
      const current = await profiles()
      const settings = await globalThis.XboostCore.loadSettings()
      return { activeId: settings.profileId, profiles: current.map(profile => ({ id: profile.id, name: profile.name, handle: profile.account.handle })) }
    }
    if (message.action === 'session-status') {
      if (await checkProfiles()) await persist()
      return discovery.summary(session, jobs)
    }
    if (['session-start', 'session-restart'].includes(message.action)) {
      const restarting = message.action === 'session-restart'
      if (restarting) {
        if (session) {
          const previousId = session.id
          await stopWorker('Stopping the current discovery session before restarting it.')
          for (const header of jobs.filter(job => job.sessionId === previousId && ['queued', 'running'].includes(job.status))) {
            const job = await repository.get(header.id)
            job.status = 'interrupted'
            job.error = 'Discovery was force-stopped before starting over.'
            await saveJob(job)
          }
          session.status = 'stopped'
          session.reason = 'Force-stopped. Ready drafts and reply history were preserved.'
          session.epoch++
          await persist()
        }
      } else if (session && !['complete', 'stopped'].includes(session.status)) throw new Error('Resume or stop the current discovery session first')
      const input = discovery.options(message.options)
      const epoch = runEpoch
      const current = await profiles()
      const selected = current.find(profile => profile.id === message.profileId)
      if (!selected) throw new Error('Select a discovery profile')
      await enableForSession()
      if (epoch !== runEpoch) throw new Error('Start cancelled')
      session = discovery.create([selected], input, jobs)
      await activateSessionIndex(session.id)
      await rememberSnapshot(selected.revision, selected.account)
      if (globalThis.xboostProfileCommand) await globalThis.xboostProfileCommand({ action: 'switch', profileId: selected.id })
      enabled = true
      lastError = ''
    } else {
      if (!session) throw new Error('Start discovery first')
      if (message.action === 'session-pause') pause()
      else if (message.action === 'session-x-blocked') {
        pause('X access problem reported. Resolve the limit, sign-in or challenge on X; nothing will be retried automatically.')
        session.retryAt = Date.now() + 15 * 60 * 1000
      } else if (message.action === 'session-stop') { pause(); session.status = 'stopped'; session.reason = 'Stopped. Existing drafts and history are preserved.' } else if (message.action === 'session-resume') {
        if (session.status !== 'paused') throw new Error('Only a paused session can resume')
        if (session.retryAt > Date.now()) throw new Error('Access-problem cooldown ends at ' + new Date(session.retryAt).toLocaleTimeString() + '. Honor any longer wait shown by X.')
        const epoch = runEpoch
        await checkProfiles()
        await enableForSession()
        if (epoch !== runEpoch) throw new Error('Resume cancelled')
        session.status = 'running'
        session.reason = ''
        session.epoch++
        enabled = true
        for (const header of jobs.filter(job => job.sessionId === session.id && job.status === 'interrupted')) {
          const profile = session.profiles.find(item => item.id === header.profileId)
          if (!profile?.blocked && discovery.compatible(header, session, profile, Date.now())) {
            const job = await repository.get(header.id)
            job.status = 'queued'
            await saveJob(job)
          }
        }
      } else if (message.action === 'session-accept-profile') {
        const index = session.profiles.findIndex(item => item.id === message.profileId)
        if (index < 0 || !session.profiles[index].blocked) throw new Error('No profile change to accept')
        const current = (await profiles()).find(item => item.id === message.profileId)
        session.profiles[index] = discovery.profileState(current)
        await rememberSnapshot(current.revision, current.account)
        session.epoch++
      } else if (message.action === 'session-revisit') {
        const profile = session.profiles.find(item => item.id === message.profileId)
        if (!profile || !profile.exhausted) throw new Error('This profile still has unvisited searches')
        if (profile.nextRetryAt > Date.now()) throw new Error('Search cooldown ends at ' + new Date(profile.nextRetryAt).toLocaleTimeString())
        profile.cursor = 0
        profile.exhausted = false
        profile.nextRetryAt = null
      } else if (['session-next', 'session-deeper'].includes(message.action)) {
        await checkProfiles()
        if (!enabled) throw new Error('Resume discovery first')
        // Each explicit click advances either one slice or a fair batch. Existing
        // extension-owned tabs are reused; unrelated tabs are never navigated.
        const requested = 1
        const opened = []
        for (let index = 0; index < requested; index++) {
          try {
            opened.push(await openNextSearch(index === 0))
          } catch (error) {
            if (!opened.length) throw error
            break
          }
        }
        session.reason = 'Opened the next search for this profile. Browse the X tab; scrolling remains manual.'
      } else if (message.action === 'session-simple-search') {
        if (!enabled) throw new Error('Resume discovery first')
        const profile = session.profiles[0]
        if (!profile.currentSearch) throw new Error('Open a discovery search first')
        const record = session.tabs.find(tab => tab.profileId === profile.id)
        if (!record) throw new Error('The discovery tab was closed. Open the next search instead.')
        const query = profile.currentFallback || profile.currentSearch.replace(/\s+-filter:replies\b/g, '').trim()
        record.url = 'https://x.com/search?' + new URLSearchParams({ q: query, f: 'live', src: 'typed_query' })
        await persist()
        await browser.tabs.update(record.id, { url: record.url, active: true })
        await syncProfileForTab(record.id)
        session.reason = 'Opened a simplified fallback without search operators. Local freshness and quality filters still apply.'
      } else throw new Error('Unknown discovery action')
    }
    await persist()
    work().catch(error => pause(error.message))
    return discovery.summary(session, jobs)
  }
  function connection () {
    if (!config.url.startsWith('ws') || !config.token) throw new Error('Configure the Codex WebSocket address and token first')
    if (!client) {
      target = { url: config.url, token: config.token }
      client = new globalThis.XboostCodex(config.url, globalThis.xboostChromeSocket || undefined)
      client.beforeConnect = () => globalThis.xboostInstallAuth({ ...target, tabId: globalThis.xboostChromeSocketHostTabId?.() })
      client.on('disconnected', error => { connectionCache = null; lastError = error.message; pause() })
    }
    return client
  }
  async function connectionStatus (force = false) {
    if (!force && connectionCache && Date.now() - connectionCache.checkedAt < 30000) return connectionCache
    if (connectionStatusPromise) return connectionStatusPromise
    connectionStatusPromise = (async () => {
      const { account } = await connection().call('account/read', { refreshToken: false })
      const limits = account ? await connection().call('account/rateLimits/read').catch(() => null) : null
      connectionCache = { account, limits, checkedAt: Date.now() }
      return connectionCache
    })().finally(() => { connectionStatusPromise = null })
    return connectionStatusPromise
  }
  async function work () {
    if (working || !enabled) return
    working = true
    try {
      while (enabled) {
        await checkProfiles()
        if (!enabled) break
        if (session?.status === 'running') {
          for (const header of jobs.filter(item => item.sessionId === session.id && item.status === 'queued')) {
            const profile = session.profiles.find(profile => profile.id === header.profileId)
            if (profile && !discovery.fresh(header, session, profile, Date.now())) {
              const item = await repository.get(header.id)
              Object.assign(item, { status: 'skipped', skipReason: 'Source post aged out before drafting. Find a fresh conversation.' })
              await saveJob(item)
            }
          }
        }
        const selected = discovery ? discovery.nextJob(session, jobs) : jobs.find(job => job.status === 'queued')
        if (!selected) { await persist(); break }
        const job = await repository.get(selected.id)
        activeJob = job
        controller = new AbortController()
        const signal = controller.signal
        job.status = 'running'
        try {
          await saveJob(job)
          await persist()
          const prompt = await globalThis.XboostReplies.prepareDraft(job.profileId, job.post, async path => {
            const response = await fetch(browser.runtime.getURL(path))
            if (!response.ok) throw new Error('Product context unavailable')
            return response.text()
          }, await accountForJob(job))
          const previous = await Promise.all([...(repliesByPost.get(job.post.id) || [])].map(id => repository.get(id)))
          if (previous.length) {
            prompt.instructions += '\nOther owned accounts already replied to this post. Do not repeat their pitches or imply independent endorsement. Skip unless this account can add genuinely distinct value.'
            prompt.input += '\n<PREVIOUS_REPLIES>' + JSON.stringify(previous.map(item => ({ account: item.expectedHandle, text: item.sentText || item.text }))) + '</PREVIOUS_REPLIES>'
          }
          const result = await connection().draft(prompt, signal)
          Object.assign(job, globalThis.XboostReplies.parseDraft(result))
          if (job.sessionId && job.status === 'ready' && jobs.some(item => item.id !== job.id && item.hasText && item.normalizedDraft === discovery.normalize(job.text))) Object.assign(job, { status: 'skipped', text: '', skipReason: 'Duplicate draft wording; find another conversation.' })
          await checkProfiles()
          if (signal.aborted) job.status = 'interrupted'
        } catch (error) {
          job.status = signal.aborted ? 'interrupted' : 'failed'
          job.error = error.message
          lastError = error.message
          if (!(job.sessionId && session?.profiles.find(profile => profile.id === job.profileId)?.blocked && enabled)) pause('Codex drafting stopped: ' + error.message + '. Resolve the issue, then resume explicitly.')
        } finally {
          controller = null
          activeJob = null
          await saveJob(job)
          await persist()
          if (session?.status === 'running' && enabled) {
            for (const tab of session.tabs) browser.tabs.sendMessage(tab.id, { type: 'xboost:session-collect' }).catch(() => {})
            const visibleTabs = await browser.tabs.query({ url: ['https://x.com/*', 'https://www.x.com/*', 'https://twitter.com/*', 'https://www.twitter.com/*'] })
            await Promise.allSettled(visibleTabs.map(tab => browser.tabs.sendMessage(tab.id, { type: 'xboost:collect-candidates' })))
          }
        }
      }
    } catch (error) { lastError = error.message; pause() } finally { working = false }
  }
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'xboost:ai-panel' || port.sender?.url !== browser.runtime.getURL('ai.html')) return
    panels.add(port)
    port.onDisconnect.addListener(() => { panels.delete(port); if (!panels.size) pause() })
  })
  async function handle (message, sender) {
    await initialized
    if (message.action?.startsWith('session-')) return sessionAction(message, sender)
    if (message.action === 'candidate-batch') {
      if (!Array.isArray(message.candidates) || message.candidates.length > 50) throw new Error('Invalid candidate batch')
      const results = []
      for (const candidate of message.candidates) results.push(await handle({ ...candidate, action: 'candidate' }, sender))
      return { results }
    }
    if (message.action === 'handoff') {
      if (!sender.tab || sender.frameId !== 0 || !/^https:\/\/(www\.)?(x|twitter)\.com\//.test(sender.url || '')) throw new Error('X tab required')
      const item = handoffs.get(sender.tab.id)
      if (!item || Date.now() - item.createdAt > 30 * 60 * 1000) return null
      const path = new URL(sender.url).pathname
      if (!new RegExp(`^/[^/]+/status/${item.postId}/?$`).test(path)) return null
      return item
    }
    if (['candidate', 'manual-select'].includes(message.action)) {
      const manual = message.action === 'manual-select'
      const epoch = runEpoch
      // Bound discovery tabs submit full batches. Highlighted posts from other X
      // tabs join the running session only when they use its selected profile.
      if (binding(sender)) return { ignored: true }
      if (!sender.tab || sender.tab.incognito || !/^https:\/\/(www\.)?(x|twitter)\.com\//.test(sender.url || '') || (!manual && !enabled)) return { ignored: true }
      const settings = await globalThis.XboostCore.loadSettings()
      if (!manual && (!enabled || !settings.enabled || settings.profileId !== message.profileId)) return { ignored: true }
      if (!manual && session?.status === 'running') {
        const profile = session.profiles[0]
        if (!profile || profile.id !== message.profileId) return { ignored: true }
        await checkProfiles()
        if (!enabled || epoch !== runEpoch || session.status !== 'running' || profile.blocked) return { ignored: true }
        const post = message.post
        const features = message.features || { id: post?.id, text: post?.text, handle: post?.author, postedAt: post?.postedAt, views: null, replies: 0, isReply: false, isPromoted: false }
        const before = jobs.length
        const result = discovery.accept(session, profile, features, jobs, globalThis.XboostCore, await ownedHandles())
        for (const job of jobs.slice(before)) await saveJob(job)
        discovery.invalidate(jobs)
        await persist()
        work().catch(error => pause(error.message))
        return { queued: result === 'queued', result }
      }
      if (!manual && session && !['stopped', 'complete'].includes(session.status)) return { ignored: true }
      const post = message.post
      if (!/^\d+$/.test(post?.id) ||
          typeof post.text !== 'string' || !post.text.trim() || !/^[a-zA-Z0-9_]{1,15}$/.test(post.author)) throw new Error('Invalid candidate')
      const catalog = await profiles()
      const captured = catalog.find(profile => profile.id === message.profileId)
      if (!captured) throw new Error('Unknown reply profile')
      if (catalog.some(profile => profile.account.handle.toLowerCase() === post.author.toLowerCase())) return { ignored: true }
      const id = `${message.profileId}:${post.id}`
      if (jobById.has(id)) return { duplicate: true }
      if (!manual && (!enabled || epoch !== runEpoch)) return { ignored: true }
      await rememberSnapshot(captured.revision, captured.account)
      await saveJob({ id, profileId: message.profileId, profileRevision: captured.revision, profileName: captured.account.product, expectedHandle: captured.account.handle, source: manual ? 'manual' : 'automatic', post: { id: post.id, text: post.text, author: post.author, postedAt: post.postedAt || null, url: `https://x.com/${post.author}/status/${post.id}` }, status: 'queued', createdAt: new Date().toISOString() })
      await persist()
      work().catch(error => { lastError = error.message; pause() })
      return { queued: true }
    }
    if (message.action === 'queue-page') {
      if (sender.url !== browser.runtime.getURL('ai.html')) throw new Error('AI panel required')
      return jobView(message)
    }
    const isSettings = sender.url === browser.runtime.getURL('options.html')
    if (sender.url !== browser.runtime.getURL('ai.html') && !isSettings) throw new Error('Extension settings or AI panel required')
    if (['save', 'login'].includes(message.action) && !isSettings) throw new Error('Configure Codex in Settings')
    if (isSettings && !['config', 'save', 'login', 'status'].includes(message.action)) throw new Error('AI panel required')
    if (message.action === 'config') return { url: config.url, enabled, configured: Boolean(config.token && config.url.startsWith('ws')) }
    if (message.action === 'save-edit') {
      if (!jobById.has(message.id) || typeof message.text !== 'string' || typeof message.writer !== 'string' || message.writer.length > 100) throw new Error('Invalid local edit')
      return repository.putEdit({ jobId: message.id, text: message.text, writer: message.writer, expectedUpdatedAt: message.expectedUpdatedAt })
    }
    if (message.action === 'mark-replied') {
      const header = jobById.get(message.id)
      if (!header || !['ready', 'replied'].includes(header.status)) throw new Error('A ready draft is required')
      const job = await repository.get(header.id)
      if (message.undo) {
        delete job.repliedAt
        delete job.sentText
        job.status = 'ready'
      } else {
        job.repliedAt = new Date().toISOString()
        job.sentText = typeof message.text === 'string' ? message.text : job.text
        job.status = 'replied'
      }
      await saveJob(job)
      await persist()
      return { ok: true }
    }
    if (message.action === 'discovery-tabs' || message.action === 'discover') {
      const tabs = (await browser.tabs.query({ url: ['https://x.com/*', 'https://www.x.com/*', 'https://twitter.com/*', 'https://www.twitter.com/*'] }))
        .filter(tab => ['/search', '/home', '/'].includes(new URL(tab.url).pathname))
      if (message.action === 'discovery-tabs') return tabs.map(tab => ({ id: tab.id, title: tab.title || tab.url }))
      if (message.mode === 'new-search') {
        const settings = await globalThis.XboostCore.loadSettings()
        await browser.tabs.create({ url: globalThis.XboostCore.searchURL(settings), active: true })
        return { message: 'Opened a Latest search for the active profile. New highlighted posts will be drafted while AI is enabled.' }
      }
      const tab = tabs.find(tab => tab.id === message.tabId)
      if (!tab) throw new Error('Select an open X search or Home tab first')
      if (!['refresh', 'more'].includes(message.mode)) throw new Error('Unknown discovery action')
      const result = await browser.tabs.sendMessage(tab.id, { type: 'xboost:discover', mode: message.mode })
      if (!result?.ok) throw new Error(result?.error || 'Reload the X tab to activate the latest Xboost version')
      if (message.mode === 'refresh') await browser.tabs.reload(tab.id)
      else await browser.tabs.update(tab.id, { active: true })
      return { message: message.mode === 'refresh' ? 'Refreshing the selected X page. New highlighted posts will be collected when it loads.' : 'Scrolled the selected X page to request more posts. X controls whether more results are available.' }
    }
    if (message.action === 'prepare') {
      const header = jobById.get(message.id)
      if (!header || header.status !== 'ready') throw new Error('Select a ready draft')
      const job = await repository.get(header.id)
      if (typeof message.text !== 'string' || !message.text.trim()) throw new Error('Reply text is empty')
      const tab = await browser.tabs.create({ url: 'about:blank', active: true })
      handoffs.set(tab.id, { text: message.text.trim(), expectedHandle: job.expectedHandle, postId: job.post.id, createdAt: Date.now() })
      try {
        await browser.tabs.update(tab.id, { url: `https://x.com/${job.post.author}/status/${job.post.id}` })
      } catch (error) { handoffs.delete(tab.id); throw error }
      return { opened: true }
    }
    if (message.action === 'save') {
      if (enabled || working) throw new Error('Stop auto-drafting and wait for the current draft before changing servers')
      const url = new URL(message.url)
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new Error('Use ws://SERVER-LAN-IP:4500 (not the 0.0.0.0 bind address)')
      const token = typeof message.token === 'string' ? message.token.trim() : ''
      if (token.length < 32 || /\s/.test(token)) throw new Error('Paste the token file contents, at least 32 characters, without whitespace')
      const previous = config
      client?.close()
      client = null
      connectionCache = null
      config = { url: url.href, token }
      try {
        await connectionStatus(true)
        await persist()
        lastError = ''
      } catch (error) {
        client?.close()
        client = null
        connectionCache = null
        target = null
        config = previous
        throw error
      }
      return { connected: true }
    }
    if (message.action === 'control') {
      if (!message.enabled) { pause(); return { enabled } }
      if (session && !['stopped', 'complete'].includes(session.status)) {
        await sessionAction({ action: 'session-resume' }, sender)
        return { enabled }
      }
      if (!panels.size) throw new Error('Keep the AI replies panel open while auto-drafting')
      if (working) throw new Error('Wait for the previous draft to stop')
      const epoch = runEpoch
      const { account } = await connection().call('account/read', { refreshToken: false })
      if (!account) throw new Error('Sign in to Codex first')
      if (!panels.size) throw new Error('AI replies panel closed')
      if (epoch !== runEpoch) throw new Error('Enabling AI was cancelled')
      enabled = true
      lastError = ''
      work().catch(error => { lastError = error.message; pause() })
      const tabs = await browser.tabs.query({ url: ['https://x.com/*', 'https://www.x.com/*', 'https://twitter.com/*', 'https://www.twitter.com/*'] })
      await Promise.allSettled(tabs.map(tab => browser.tabs.sendMessage(tab.id, { type: 'xboost:collect-candidates' })))
      return { enabled }
    }
    if (message.action === 'status') {
      const queue = sender.url === browser.runtime.getURL('ai.html') ? await jobView(message) : { jobs: [] }
      if (!config.url || !config.token) return { enabled: false, account: null, limits: null, ...queue, lastError }
      try {
        const { account, limits } = await connectionStatus(Boolean(message.refresh))
        return { enabled, account, limits, ...queue, lastError }
      } catch (error) {
        return { enabled, account: null, limits: null, ...queue, lastError: error.message }
      }
    }
    if (message.action === 'login') return connection().call('account/login/start', { type: 'chatgptDeviceCode' })
    if (message.action === 'dismiss') {
      const header = jobById.get(message.id)
      if (header && header.status !== 'running' && !header.repliedAt) {
        const job = await repository.get(header.id)
        job.status = 'dismissed'
        await saveJob(job)
        await persist()
      }
      return { ok: true }
    }
    if (message.action === 'retry') {
      const header = jobById.get(message.id)
      if (!header || !['skipped', 'failed', 'interrupted'].includes(header.status)) throw new Error('This draft cannot be retried')
      const job = await repository.get(header.id)
      Object.assign(job, { status: 'queued', text: '', error: '', skipReason: '' })
      await repository.deleteEdit(job.id)
      await saveJob(job)
      await persist()
      work().catch(error => { lastError = error.message; pause() })
      return { queued: true }
    }
    throw new Error('Unknown AI action')
  }
  let actions = Promise.resolve()
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'xboost:ai') return undefined
    if (['session-pause', 'session-stop', 'session-restart', 'session-x-blocked'].includes(message.action) || (message.action === 'control' && !message.enabled)) {
      if (sender.url === browser.runtime.getURL('ai.html')) pause()
    }
    const result = message.action?.startsWith('session-') || ['candidate', 'manual-select', 'save', 'control', 'dismiss', 'retry', 'login', 'mark-replied'].includes(message.action)
      ? (actions = actions.catch(() => {}).then(() => handle(message, sender)))
      : handle(message, sender)
    return result.then(data => ({ ok: true, data }), error => ({ ok: false, error: error.message }))
  })
})()
