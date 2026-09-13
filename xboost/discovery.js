'use strict'

// Pure session policy. Browser navigation and Codex calls live in the background.
globalThis.XboostDiscovery = (() => {
  const KEY = 'xboost:discovery-session'
  const MAX_RECENT_SEEN = 4000
  const SEEN_TRIM_SIZE = 500
  const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
  const normalize = value => String(value || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const hasText = job => job.hasText === undefined ? Boolean(job.text?.trim()) : job.hasText
  const normalizedPost = job => job.normalizedPost === undefined ? normalize(job.post?.text) : job.normalizedPost
  const indexes = new WeakMap()
  function jobIndex (jobs) {
    const cached = indexes.get(jobs)
    if (cached?.length === jobs.length) return cached
    const value = { length: jobs.length, ids: new Set(), sources: new Set(), replied: new Set(), queued: new Map(), authors: new Map(), texts: new Map(), profiles: new Map(), sessions: new Map(), counts: new Map() }
    for (const job of jobs) {
      value.ids.add(job.id)
      value.sources.add(`${job.profileId}:${job.post?.id}`)
      if (job.repliedAt) value.replied.add(job.post?.id)
      if (!value.profiles.has(job.profileId)) value.profiles.set(job.profileId, [])
      value.profiles.get(job.profileId).push(job)
      if (job.sessionId) {
        const scope = `${job.sessionId}:${job.profileId}`
        if (!value.sessions.has(scope)) value.sessions.set(scope, [])
        value.sessions.get(scope).push(job)
        const author = `${scope}:${String(job.post?.author || '').toLowerCase()}`
        value.authors.set(author, (value.authors.get(author) || 0) + 1)
        if (!value.texts.has(scope)) value.texts.set(scope, new Set())
        if (normalizedPost(job)) value.texts.get(scope).add(normalizedPost(job))
        if (job.status === 'queued') {
          if (!value.queued.has(scope)) value.queued.set(scope, [])
          value.queued.get(scope).push(job)
        }
      }
    }
    indexes.set(jobs, value)
    return value
  }
  function invalidate (jobs) { indexes.delete(jobs) }
  function options (input = {}) {
    const value = { target: Number(input.target ?? 100), ageHours: Number(input.ageHours ?? 24), backlog: Number(input.backlog ?? 20), authorLimit: Number(input.authorLimit ?? 3) }
    if (!Object.values(value).every(positive)) throw new Error('Target, freshness hours, backlog and author limit must be positive whole numbers')
    return value
  }
  function queries (profile) {
    const clean = value => value.replace(/["\\\r\n]/g, ' ').trim()
    const unique = values => {
      const seen = new Set()
      return values.map(clean).filter(value => {
        const key = value.toLowerCase()
        if (!value || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    const terms = unique(profile.settings.keywords)
    // Only use context vocabulary already supplied by the owner; never rewrite
    // saved keywords or infer capabilities from these literal search variants.
    const contexts = [profile.account.context, ...(profile.account.portfolio || []).map(item => item.context)].join('\n')
    const vocabulary = ['transaction 2FA', 'wallet security', 'WalletConnect', 'Telegram wallet', 'historical balances', 'Solana RPC', 'token balances', 'blockchain accounting', 'price alerts', 'market data', 'portfolio tracker', 'crypto dashboard', 'infrastructure automation', 'incident response', 'server management', 'AI agents', 'open source', 'developer tools']
    const tags = vocabulary.filter(term => contexts.toLowerCase().includes(term.toLowerCase()))
    if (!terms.length) terms.push(clean(profile.name))
    const seeds = unique([...terms, ...tags])
    const groups = []
    for (let index = 0; index < seeds.length; index += 3) groups.push(seeds.slice(index, index + 3))
    const intents = [
      { label: 'Topic conversations', text: '' },
      { label: 'Recommendations', text: 'recommend' },
      { label: 'Looking for tools', text: '"looking for"' },
      { label: 'Alternatives', text: 'alternative' },
      { label: 'Problems', text: 'problem' },
      { label: 'Help requests', text: 'help' },
      { label: 'Builders', text: 'building' },
      { label: 'Open source', text: '"open source"' }
    ]
    const directPosts = '-filter:replies'
    const result = []
    for (const group of groups) {
      const topics = group.map(seed => '"' + seed + '"')
      const topic = topics.length > 1 ? '(' + topics.join(' OR ') + ')' : topics[0]
      for (const intent of intents) {
        const query = [topic, intent.text, directPosts].filter(Boolean).join(' ')
        const fallback = [topics[0], intent.text].filter(Boolean).join(' ')
        result.push({ label: intent.label + ' - Latest', query, fallback, mode: 'live' })
        result.push({ label: intent.label + ' - Top', query, fallback, mode: 'top' })
      }
    }
    const sharing = ['share your project', 'drop what you are building', 'share your URL'].map(phrase => `"${phrase}"`)
    const sharingQuery = '(' + sharing.join(' OR ') + ') ' + directPosts
    result.push({ label: 'Project sharing - Latest', query: sharingQuery, fallback: sharing[0], mode: 'live' })
    result.push({ label: 'Project sharing - Top', query: sharingQuery, fallback: sharing[0], mode: 'top' })
    return result
  }
  async function catalog (core, state, accounts, readContext) {
    const accountFor = async id => {
      const base = accounts[id]
      const detail = state.details?.[id]
      if (!base && !detail) throw new Error('Profile identity/context is missing: ' + id)
      const context = detail?.context ?? (base?.file ? await readContext('products/' + base.file) : 'Account owner: Eugene Gusev (@quellemor). No founder biography or personal experience claims have been supplied. Do not invent either. Respond constructively without forcing a product promotion.')
      return { product: detail?.name || base.product, handle: detail?.handle || base.handle, context, file: null }
    }
    const resolved = {}
    const definitions = core.profileDefinitions(state)
    for (const definition of definitions) resolved[definition.id] = await accountFor(definition.id)
    if (resolved.founder) resolved.founder.portfolio = definitions.filter(item => item.id !== 'founder').map(item => ({ ...resolved[item.id] }))
    const result = []
    for (const definition of definitions) {
      const settings = core.coerceSettings({ ...state.profiles[definition.id], profileId: definition.id, enabled: true })
      const account = resolved[definition.id]
      const policy = { ...settings }
      for (const field of ['enabled', 'showBadges', 'dimOpacity', 'dimNonMatches']) delete policy[field]
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ account, policy })))
      const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      result.push({ id: definition.id, name: account.product, settings, account, revision })
    }
    return result
  }
  function profileState (profile) {
    return { ...profile, queries: queries(profile), cursor: 0, visits: {}, seen: {}, seenSize: 0, inspected: 0, seenTrimmed: 0, reasons: {}, blocked: '', exhausted: false, currentSearch: '', currentFallback: '', nextRetryAt: null }
  }
  function upgrade (session) {
    if (!session) return session
    for (const profile of session.profiles || []) {
      profile.seen = profile.seen || {}
      profile.seenSize = Object.keys(profile.seen).length
      profile.inspected = Math.max(Number(profile.inspected) || 0, profile.seenSize)
      profile.seenTrimmed = Number(profile.seenTrimmed) || 0
    }
    if (session.queryVersion === 4) return session
    for (const profile of session.profiles || []) {
      const visited = new Set((profile.queries || []).filter((query, index) => profile.visits?.[index]).map(query => query.query))
      const generated = queries(profile)
      const done = generated.filter(query => visited.has(query.query))
      profile.queries = [...done, ...generated.filter(query => !visited.has(query.query))]
      profile.cursor = done.length
      profile.visits = Object.fromEntries(done.map((query, index) => [index, profile.visits?.[index] || session.startedAt]))
      profile.exhausted = profile.cursor >= profile.queries.length
      if (!profile.exhausted) profile.nextRetryAt = null
    }
    session.queryVersion = 4
    return session
  }
  function create (profiles, input, jobs, now = Date.now()) {
    const created = { id: globalThis.crypto.randomUUID(), ...options(input), status: 'running', startedAt: now, baseline: [], cursor: 0, workerCursor: 0, profiles: profiles.map(profileState), tabs: [], allocated: {}, reason: '', epoch: 0, queryVersion: 4 }
    created.baseline = jobs.filter(job => job.status === 'ready' && hasText(job) && created.profiles.some(profile => compatible(job, created, profile, now))).map(job => job.id)
    return created
  }
  function fresh (job, session, profile, now) {
    const postedAt = Date.parse(job.post.postedAt)
    const maxMinutes = Math.min(session.ageHours * 60, profile.settings.maxAgeMinutes || Infinity)
    return Number.isFinite(postedAt) && postedAt <= now + 60000 && now - postedAt <= maxMinutes * 60000
  }
  function compatible (job, session, profile, now) {
    return job.profileId === profile.id && job.profileRevision === profile.revision && fresh(job, session, profile, now)
  }
  function counts (session, profile, jobs, now = Date.now()) {
    const index = jobIndex(jobs)
    const cacheKey = `${session.id}:${profile.id}:${profile.revision}:${session.ageHours}:${profile.settings.maxAgeMinutes}`
    let cached = index.counts.get(cacheKey)
    if (!cached || now >= cached.expiresAt) {
      const profileJobs = index.profiles.get(profile.id) || []
      const sessionJobs = index.sessions.get(`${session.id}:${profile.id}`) || []
      const ready = profileJobs.filter(job => job.status === 'ready' && hasText(job) && compatible(job, session, profile, now))
      const baseline = new Set(session.baseline)
      const maxMinutes = Math.min(session.ageHours * 60, profile.settings.maxAgeMinutes || Infinity)
      const expiresAt = Number.isFinite(maxMinutes)
        ? [...ready, ...sessionJobs.filter(job => ['queued', 'running'].includes(job.status) && compatible(job, session, profile, now))].reduce((next, job) => Math.min(next, Date.parse(job.post.postedAt) + maxMinutes * 60000 + 1), Infinity)
        : Infinity
      cached = {
        ready: ready.length,
        existing: ready.filter(job => baseline.has(job.id)).length,
        generated: ready.filter(job => !baseline.has(job.id)).length,
        awaiting: sessionJobs.filter(job => ['queued', 'running'].includes(job.status) && compatible(job, session, profile, now)).length,
        skipped: sessionJobs.filter(job => ['skipped', 'failed', 'interrupted'].includes(job.status)).length,
        older: profileJobs.filter(job => job.status === 'ready' && !compatible(job, session, profile, now)).length,
        expiresAt
      }
      index.counts.set(cacheKey, cached)
    }
    return { ready: cached.ready, existing: cached.existing, generated: cached.generated, awaiting: cached.awaiting, skipped: cached.skipped, inspected: Math.max(Number(profile.inspected) || 0, Object.keys(profile.seen || {}).length), rejected: Object.values(profile.reasons).reduce((sum, n) => sum + n, 0), older: cached.older }
  }
  function summary (session, jobs, now = Date.now()) {
    if (!session) return null
    return {
      id: session.id,
      status: session.status,
      target: session.target,
      ageHours: session.ageHours,
      reason: session.reason + (session.retryAt > now ? ' Earliest manual resume: ' + new Date(session.retryAt).toLocaleString() + '.' : ''),
      profiles: session.profiles.map(profile => {
        const progress = counts(session, profile, jobs, now)
        const state = profile.blocked ? 'profile changed' : progress.ready >= session.target ? 'complete' : session.status !== 'running' ? session.status : progress.awaiting ? 'drafting' : profile.exhausted ? 'searches visited' : 'awaiting your search/scroll'
        const ranked = Object.entries(profile.reasons).sort((a, b) => b[1] - a[1])
        const dominant = ranked[0]
        const guidance = dominant?.[0] === 'reply without verified parent context'
          ? 'Most rejected results are replies without visible parent context. New deep searches exclude replies.'
          : dominant?.[0] === 'stale or unknown age'
            ? 'Most rejected results are outside the visible freshness window. Increase maximum post age only if you want older conversations.'
            : dominant?.[0] === 'no keyword match'
              ? 'Most results do not contain current targeting terms. Continue to the next narrower search or edit profile keywords.'
              : dominant?.[0] === 'below score threshold'
                ? 'Most results match but score below the current profile threshold. Continue through intent-focused searches before changing quality settings.'
                : ''
        return { id: profile.id, name: profile.name, ...progress, state, reason: profile.blocked || (profile.exhausted ? 'All search variants visited. No automatic revisit; browse existing searches or explicitly revisit after cooldown.' : ''), guidance, currentSearch: profile.currentSearch, nextRetryAt: profile.nextRetryAt, rejectionReasons: profile.reasons }
      })
    }
  }
  function chooseSearch (session, jobs, now = Date.now()) {
    if (session.status !== 'running') throw new Error('Resume discovery first')
    for (let step = 0; step < session.profiles.length; step++) {
      const index = (session.cursor + step) % session.profiles.length
      const profile = session.profiles[index]
      const progress = counts(session, profile, jobs, now)
      if (profile.blocked || profile.exhausted || progress.ready + progress.awaiting >= session.target || progress.awaiting >= session.backlog) continue
      const queryIndex = profile.cursor
      const query = profile.queries[queryIndex]
      if (!query) { profile.exhausted = true; continue }
      session.cursor = (index + 1) % session.profiles.length
      profile.cursor++
      profile.visits[queryIndex] = now
      profile.currentSearch = query.query
      profile.currentFallback = query.fallback
      profile.currentMode = query.mode || 'live'
      profile.exhausted = profile.cursor >= profile.queries.length
      profile.nextRetryAt = profile.exhausted ? now + 15 * 60 * 1000 : null
      return { profile, query }
    }
    throw new Error('No next search: targets/backlogs are filled, profiles changed, or all search variants were visited. Review the progress below.')
  }
  function nextJob (session, jobs, now = Date.now()) {
    if (!session || ['stopped', 'complete'].includes(session.status)) return jobs.find(job => job.status === 'queued' && !job.sessionId)
    if (session.status !== 'running') return null
    for (let step = 0; step < session.profiles.length; step++) {
      const index = (session.workerCursor + step) % session.profiles.length
      const profile = session.profiles[index]
      if (profile.blocked || counts(session, profile, jobs, now).ready >= session.target) continue
      const job = (jobIndex(jobs).queued.get(`${session.id}:${profile.id}`) || []).find(job => job.status === 'queued' && compatible(job, session, profile, now))
      if (job) { session.workerCursor = (index + 1) % session.profiles.length; return job }
    }
    return null
  }
  function accept (session, profile, features, jobs, core, owned, now = Date.now()) {
    if (session.status !== 'running' || profile.blocked) return 'paused'
    if (!/^\d+$/.test(features?.id) || !/^[\w]{1,15}$/.test(features.handle || '') || !features.text?.trim()) return 'invalid'
    const progress = counts(session, profile, jobs, now)
    if (progress.ready + progress.awaiting >= session.target || progress.awaiting >= session.backlog) return 'backpressure'
    profile.seen = profile.seen || {}
    if (Object.hasOwn(profile.seen, features.id)) return 'seen'
    profile.seenSize = Number(profile.seenSize) || Object.keys(profile.seen).length
    profile.inspected = Math.max(Number(profile.inspected) || 0, profile.seenSize) + 1
    profile.seen[features.id] = true
    profile.seenSize++
    if (profile.seenSize > MAX_RECENT_SEEN) {
      for (const id of Object.keys(profile.seen).slice(0, SEEN_TRIM_SIZE)) delete profile.seen[id]
      profile.seenSize -= SEEN_TRIM_SIZE
      profile.seenTrimmed = (Number(profile.seenTrimmed) || 0) + SEEN_TRIM_SIZE
    }
    const reject = reason => { profile.reasons[reason] = (profile.reasons[reason] || 0) + 1; return reason }
    if (owned.has(features.handle.toLowerCase())) return reject('owned account')
    const index = jobIndex(jobs)
    if (session.allocated[features.id] || index.sources.has(`${profile.id}:${features.id}`) || index.replied.has(features.id)) return reject('duplicate/history')
    const post = { id: features.id, text: features.text, author: features.handle, postedAt: features.postedAt, url: `https://x.com/${features.handle}/status/${features.id}` }
    if (!fresh({ post }, session, profile, now)) return reject('stale or unknown age')
    if (features.isReply) return reject('reply without verified parent context')
    const result = core.scorePost({ ...features, ageMinutes: (now - Date.parse(post.postedAt)) / 60000 }, profile.settings)
    if (result.excluded || !result.scorable || result.score < profile.settings.threshold) return reject(result.reason || 'below score threshold')
    const scope = `${session.id}:${profile.id}`
    if ((index.authors.get(`${scope}:${features.handle.toLowerCase()}`) || 0) >= session.authorLimit) return reject('author diversity limit')
    if (index.texts.get(scope)?.has(normalize(post.text))) return reject('duplicate post text')
    session.allocated[post.id] = profile.id
    jobs.push({ id: profile.id + ':' + post.id, sessionId: session.id, profileId: profile.id, profileRevision: profile.revision, profileName: profile.account.product, expectedHandle: profile.account.handle, post, source: 'discovery', status: 'queued', createdAt: new Date(now).toISOString() })
    invalidate(jobs)
    return 'queued'
  }
  return { KEY, MAX_RECENT_SEEN, options, queries, catalog, profileState, upgrade, create, fresh, compatible, counts, summary, chooseSearch, nextJob, accept, normalize, invalidate }
})()
if (typeof module !== 'undefined') module.exports = globalThis.XboostDiscovery
