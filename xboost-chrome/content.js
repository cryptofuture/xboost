/* global browser, location, MutationObserver, requestIdleCallback */

'use strict'

// Firefox may inject this once from the manifest and once from the install-time
// backfill. Keep the observer and storage listener strictly single-instance.
;(function startXboost () {
  if (globalThis.__xboostContentStarted) return
  globalThis.__xboostContentStarted = true

  const core = globalThis.XboostCore
  if (!core) {
    console.error('[xboost] Shared scoring core is unavailable')
    return
  }

  // All assumptions about X markup live in this block. X changes frequently;
  // keeping these together makes maintenance a small, auditable task.
  const SELECTOR = {
    timeline: '[data-testid="primaryColumn"]',
    timelineFallback: 'main[role="main"]',
    post: 'article[data-testid="tweet"]',
    timestamp: 'time[datetime]',
    permalink: 'a[href*="/status/"]',
    text: '[data-testid="tweetText"]',
    userName: '[data-testid="User-Name"]',
    metricsGroup: 'div[role="group"][aria-label]',
    replyButton: '[data-testid="reply"]',
    viewsLink: 'a[href$="/analytics"]',
    quote: 'div[role="link"][tabindex]',
    socialContext: '[data-testid="socialContext"]',
    replyContext: 'div[dir]'
  }

  const PROMOTED_LABELS = ['promoted', 'ad', 'anzeige', 'promocionado', 'sponsorisé', 'promosso', '広告']
  const REPLY_PREFIXES = ['replying to', 'respondiendo a', 'en respuesta a', 'antwort an', 'en réponse à', 'in risposta a', 'respondendo a', '返信先']
  const DEBOUNCE_MS = 120
  const WORK_BUDGET_MS = 35
  const SLICE_SIZE = 12
  const URL_POLL_MS = 700
  const DISCOVERY_SENT_LIMIT = 1000

  let settings = core.DEFAULT_SETTINGS
  let globalSettings = settings
  let discoveryBinding = null
  let collecting = false
  let generation = 0
  let observer = null
  let observedRoot = null
  let scanTimer
  let draining = false
  let lastUrl = location.href
  let queue = []
  let fullScan = true
  const changedPosts = new Set()
  const queued = new Set()
  const scoredAt = new WeakMap()
  const cached = new WeakMap()
  const discoverySent = new Set()
  const discoveryPending = new Map()
  const candidatePending = new Map()
  let candidateTimer
  let candidateSending = false
  const defaultOwnedHandles = ['BitcoinWidget', 'index_solana', 'outruna_wallet', 'IntentAIOps', 'quellemor']
  let ownedHandles = new Set(defaultOwnedHandles.map(handle => handle.toLowerCase()))

  function updateOwnedHandles (state) {
    ownedHandles = new Set([...defaultOwnedHandles, ...Object.values(state?.details || {}).map(detail => detail.handle)].filter(Boolean).map(handle => handle.replace(/^@/, '').toLowerCase()))
  }

  initialize().catch(error => console.error('[xboost] Initialization failed', error))

  async function initialize () {
    settings = await core.loadSettings()
    globalSettings = settings
    await refreshDiscovery()
    updateOwnedHandles((await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY])
    browser.storage.onChanged.addListener(onStorageChanged)
    browser.runtime.onMessage.addListener(onMessage)
    watchNavigation()
    if (settings.enabled) start()
  }

  function start () {
    ensureObserver()
    scheduleScan(true)
  }

  function stop () {
    if (observer) observer.disconnect()
    observer = null
    observedRoot = null
    queue = []
    queued.clear()
    discoverySent.clear()
    discoveryPending.clear()
    candidatePending.clear()
    if (candidateTimer !== undefined) clearTimeout(candidateTimer)
    candidateTimer = undefined
    clearDecorations()
  }

  function ensureObserver () {
    const root = document.querySelector(SELECTOR.timeline) ||
      document.querySelector(SELECTOR.timelineFallback) || document.body
    if (!root) return
    if (observer && observedRoot === root && root.isConnected) return
    if (observer) observer.disconnect()
    observedRoot = root
    observer = new MutationObserver(onMutations)
    observer.observe(root, { childList: true, characterData: true, subtree: true })
  }

  function scheduleScan (force = false) {
    if (force === true) fullScan = true
    if (scanTimer !== undefined) return
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined
      scan()
    }, DEBOUNCE_MS)
  }

  function scan () {
    if (!settings.enabled) return
    ensureObserver()
    const posts = fullScan ? [...document.querySelectorAll(SELECTOR.post)] : [...changedPosts]
    fullScan = false
    changedPosts.clear()
    for (const post of posts) {
      if (!post.isConnected) continue
      const previous = cached.get(post)
      // X can recycle an article node for a different post while scrolling.
      if (previous && previous.features.id !== readId(post)) {
        scoredAt.delete(post)
        cached.delete(post)
      }
      if (scoredAt.get(post) === generation) {
        repairDecoration(post)
      } else if (!queued.has(post)) {
        queued.add(post)
        queue.push(post)
      }
    }
    if (!draining) drain().catch(reportDrainError)
  }

  function onMutations (records = []) {
    if (!records.length) { scheduleScan(true); return }
    const add = node => {
      if (!node || node.nodeType !== 1) return
      if (node.matches?.('[data-xboost-select], [data-xboost-badge]')) return
      const own = node.matches?.(SELECTOR.post) ? node : node.closest?.(SELECTOR.post)
      if (own) changedPosts.add(own)
      for (const post of node.querySelectorAll?.(SELECTOR.post) || []) changedPosts.add(post)
    }
    for (const record of records) {
      if (record.addedNodes?.length && [...record.addedNodes].every(node => node.nodeType === 1 && node.matches?.('[data-xboost-select], [data-xboost-badge]'))) continue
      add(record.target)
      for (const node of record.addedNodes || []) add(node)
    }
    for (const post of changedPosts) {
      scoredAt.delete(post)
      cached.delete(post)
    }
    scheduleScan()
  }

  async function refreshDiscovery () {
    const response = await browser.runtime.sendMessage({ type: 'xboost:ai', action: 'session-context' })
    const next = response?.ok && response.data?.bound ? response.data : null
    if (JSON.stringify(next) === JSON.stringify(discoveryBinding)) return
    discoveryBinding = next
    discoverySent.clear()
    discoveryPending.clear()
    settings = next ? { ...next.settings, enabled: globalSettings.enabled } : globalSettings
    generation++
    let banner = document.getElementById('xboost-discovery-banner')
    if (next) {
      if (!banner) {
        banner = document.createElement('div')
        banner.id = 'xboost-discovery-banner'
        banner.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483646;max-width:320px;padding:10px 14px;border:1px solid #5384e8;border-radius:10px;background:#15202b;color:white;font:13px system-ui;pointer-events:none'
        document.body.append(banner)
      }
      banner.textContent = 'Xboost discovery: ' + next.name + (next.active ? ' - active tab selects this Xboost profile. Scroll to load candidates.' : ' - paused, complete or profile changed. Check AI replies.')
    } else banner?.remove()
    if (settings.enabled) scheduleScan(true)
  }

  async function collectDiscovery () {
    if (!discoveryBinding?.active || collecting || !settings.enabled) return
    collecting = true
    const epoch = discoveryBinding.epoch
    try {
      const features = [...discoveryPending.values()]
      for (let start = 0; start < features.length; start += 50) {
        if (!discoveryBinding?.active || epoch !== discoveryBinding.epoch) break
        const batch = features.slice(start, start + 50)
        const response = await browser.runtime.sendMessage({ type: 'xboost:ai', action: 'session-batch', epoch, features: batch })
        if (response?.ok && !response.data?.ignored) {
          const results = Array.isArray(response.data?.results) ? response.data.results : []
          for (const [index, feature] of batch.entries()) {
            if (!['backpressure', 'paused'].includes(results[index])) {
              discoverySent.add(feature.id)
              discoveryPending.delete(feature.id)
            }
          }
          while (discoverySent.size > DISCOVERY_SENT_LIMIT) discoverySent.delete(discoverySent.values().next().value)
        }
      }
    } finally { collecting = false }
  }

  async function drain () {
    draining = true
    try {
      let startedAt = performance.now()
      while (queue.length && settings.enabled) {
        const currentGeneration = generation
        const slice = queue.splice(0, SLICE_SIZE)
        for (const post of slice) queued.delete(post)

        for (const post of slice) {
          if (!post.isConnected || scoredAt.get(post) === currentGeneration) continue
          try {
            const features = extractFeatures(post, Date.now())
            const result = core.scorePost(features, settings)
            if (generation !== currentGeneration) break
            scoredAt.set(post, currentGeneration)
            cached.set(post, { features, result })
            if (discoveryBinding?.active && features.id && !discoverySent.has(features.id)) discoveryPending.set(features.id, features)
            decorate(post, features, result)
            manualButton(post, features)
            offerCandidate(features, result)
          } catch (error) {
            scoredAt.set(post, currentGeneration)
            console.warn('[xboost] Could not score a post', error)
          }
        }

        if (performance.now() - startedAt >= WORK_BUDGET_MS) {
          await yieldToBrowser()
          startedAt = performance.now()
        }
      }
    } finally {
      draining = false
      if (queue.length && settings.enabled) drain().catch(reportDrainError)
      else collectDiscovery().catch(error => console.warn('[xboost] Discovery collection failed', error))
    }
  }

  function reportDrainError (error) {
    draining = false
    console.error('[xboost] Scanning failed', error)
  }

  function extractFeatures (post, now) {
    const metrics = readMetrics(post)
    return {
      ageMinutes: core.ageMinutesFromISO(queryOwn(post, SELECTOR.timestamp)?.getAttribute('datetime'), now),
      postedAt: queryOwn(post, SELECTOR.timestamp)?.getAttribute('datetime') || null,
      views: metrics.views,
      replies: metrics.replies,
      likes: metrics.likes,
      handle: readHandle(post),
      text: readText(post),
      isReply: detectReply(post),
      isPromoted: detectPromoted(post),
      id: readId(post)
    }
  }

  function readMetrics (post) {
    let parsed = { replies: null, likes: null, views: null }
    for (const group of queryOwnAll(post, SELECTOR.metricsGroup)) {
      const candidate = core.parseMetricsLabel(group.getAttribute('aria-label'))
      if (Object.values(candidate).some(value => value !== null)) {
        parsed = candidate
        break
      }
    }
    return {
      replies: parsed.replies ?? readReplyCount(post),
      likes: parsed.likes,
      views: parsed.views ?? readViews(post)
    }
  }

  function readReplyCount (post) {
    const button = queryOwn(post, SELECTOR.replyButton)
    if (!button) return null
    const label = core.parseMetricsLabel(button.getAttribute('aria-label'))
    return label.replies ?? core.parseCompactNumber(button.textContent)
  }

  function readViews (post) {
    const link = queryOwn(post, SELECTOR.viewsLink)
    if (!link) return null
    const label = core.parseMetricsLabel(link.getAttribute('aria-label'))
    return label.views ?? core.parseCompactNumber(link.textContent)
  }

  function readHandle (post) {
    const name = queryOwn(post, SELECTOR.userName)
    if (name) {
      for (const node of name.querySelectorAll('span, a')) {
        const text = (node.textContent || '').trim()
        if (text.startsWith('@') && text.length > 1) return core.normaliseHandle(text)
      }
    }
    const href = queryOwn(post, SELECTOR.permalink)?.getAttribute('href')
    return href ? core.normaliseHandle((href.split('/status/')[0] || '').replace(/^\//, '')) : null
  }

  function readId (post) {
    const href = queryOwn(post, SELECTOR.permalink)?.getAttribute('href') || ''
    return href.match(/\/status\/(\d+)/)?.[1] || null
  }

  function readText (post) {
    return queryOwnAll(post, SELECTOR.text)
      .map(node => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function detectPromoted (post) {
    const text = (queryOwn(post, SELECTOR.socialContext)?.textContent || '').trim().toLowerCase()
    return PROMOTED_LABELS.some(label => text === label || text.startsWith(`${label} `))
  }

  function detectReply (post) {
    const body = queryOwn(post, SELECTOR.text)
    for (const candidate of post.querySelectorAll(SELECTOR.replyContext)) {
      if (body && (candidate === body || candidate.contains(body))) break
      if (isInsideQuote(candidate, post)) continue
      const text = (candidate.textContent || '').trim().toLowerCase()
      if (REPLY_PREFIXES.some(prefix => text.startsWith(prefix))) return true
    }
    return false
  }

  function isInsideQuote (element, post) {
    const quote = element.closest(SELECTOR.quote)
    return quote !== null && quote !== post && post.contains(quote)
  }

  function queryOwn (post, selector) {
    return queryOwnAll(post, selector)[0] || null
  }

  function queryOwnAll (post, selector) {
    return Array.from(post.querySelectorAll(selector)).filter(element => !isInsideQuote(element, post))
  }

  function decorate (post, features, result) {
    if (!result.scorable) {
      undecorate(post)
      return
    }

    const isHit = !result.excluded && result.score >= settings.threshold
    if (!isHit && !settings.dimNonMatches) {
      undecorate(post)
      return
    }
    post.setAttribute('data-xboost', isHit ? 'hit' : 'dim')
    post.style.setProperty('--xboost-dim-opacity', String(settings.dimOpacity / 100))

    if (isHit) {
      post.setAttribute('data-xboost-tier', result.score >= 85 ? 'top' : 'good')
      if (settings.showBadges) renderBadge(post, features, result)
      else removeBadge(post)
    } else {
      post.removeAttribute('data-xboost-tier')
      removeBadge(post)
    }
  }

  function renderBadge (post, features, result) {
    let badge = post.querySelector(':scope > [data-xboost-badge]')
    if (!badge) {
      badge = document.createElement('div')
      badge.setAttribute('data-xboost-badge', '')
      badge.setAttribute('role', 'img')
      post.appendChild(badge)
    }
    const label = String(result.score)
    badge.textContent = label
    const tip = core.explainPost(features, result)
    badge.setAttribute('data-xboost-tip', tip)
    badge.setAttribute('aria-label', `Xboost score ${label}. ${tip}`)
    positionBadge(post, badge)
  }

  function positionBadge (post, badge) {
    const timestamp = queryOwn(post, SELECTOR.timestamp)
    const anchor = timestamp?.closest('a') || timestamp
    if (!anchor) {
      badge.style.removeProperty('top')
      badge.style.removeProperty('left')
      badge.style.removeProperty('transform')
      return
    }
    const postBox = post.getBoundingClientRect()
    const anchorBox = anchor.getBoundingClientRect()
    badge.style.top = `${anchorBox.top - postBox.top + anchorBox.height / 2}px`
    badge.style.left = `${anchorBox.right - postBox.left + 7}px`
    badge.style.transform = 'translateY(-50%)'
  }

  function removeBadge (post) {
    post.querySelector(':scope > [data-xboost-badge]')?.remove()
  }

  function undecorate (post) {
    post.removeAttribute('data-xboost')
    post.removeAttribute('data-xboost-tier')
    post.style.removeProperty('--xboost-dim-opacity')
    removeBadge(post)
  }

  function clearDecorations () {
    for (const button of document.querySelectorAll('[data-xboost-select]')) button.remove()
    for (const post of document.querySelectorAll('[data-xboost]')) undecorate(post)
    for (const badge of document.querySelectorAll('[data-xboost-badge]')) badge.remove()
  }

  function repairDecoration (post) {
    const value = cached.get(post)
    if (value && !post.hasAttribute('data-xboost')) decorate(post, value.features, value.result)
    if (value) manualButton(post, value.features)
  }

  function manualButton (post, features) {
    if (discoveryBinding) {
      post.querySelector(':scope > [data-xboost-select]')?.remove()
      return
    }
    if (ownedHandles.has(features.handle?.toLowerCase())) {
      post.querySelector(':scope > [data-xboost-select]')?.remove()
      return
    }
    if (!features.id || !features.handle || !features.text || post.querySelector(':scope > [data-xboost-select]')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-xboost-select', '')
    button.textContent = 'Select for AI'
    button.style.cssText = 'position:relative;z-index:2;margin:6px 12px;padding:5px 10px;border:1px solid #5384e8;border-radius:14px;background:#15202b;color:#fff;cursor:pointer;font:12px system-ui'
    button.onclick = event => {
      event.preventDefault()
      event.stopPropagation()
      const current = extractFeatures(post, Date.now())
      if (!ownedHandles.has(current.handle?.toLowerCase())) globalThis.XboostSelection.open(current, settings)
    }
    post.append(button)
  }

  function onStorageChanged (changes, area) {
    if (area === 'local' && changes['xboost:discovery-session']) refreshDiscovery().catch(() => {})
    if (area === 'local' && changes[core.PROFILE_KEY]) {
      updateOwnedHandles(changes[core.PROFILE_KEY].newValue)
      generation++
      if (settings.enabled) scheduleScan(true)
    }
    if (area !== 'local' || !changes[core.STORAGE_KEY]) return
    const wasEnabled = settings.enabled
    globalSettings = core.coerceSettings(changes[core.STORAGE_KEY].newValue)
    settings = discoveryBinding ? { ...discoveryBinding.settings, enabled: globalSettings.enabled } : globalSettings
    if (!settings.enabled) {
      stop()
      return
    }
    generation += 1
    queue = []
    queued.clear()
    if (!wasEnabled) start()
    else scheduleScan(true)
  }

  function onMessage (message) {
    if (message?.type === 'xboost:session-collect') {
      return refreshDiscovery().then(collectDiscovery).then(() => ({ ok: true }))
    }
    if (message?.type === 'xboost:discover') {
      if (!['/search', '/home', '/'].includes(location.pathname)) return Promise.resolve({ ok: false, error: 'Use an X search or Home page' })
      const editors = [...document.querySelectorAll('[contenteditable="true"]')]
      if (editors.some(editor => editor.textContent.trim()) || document.querySelector('[role="dialog"]')) return Promise.resolve({ ok: false, error: 'Close dialogs and save any composer text in the selected X tab first' })
      if (message.mode === 'more') {
        window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 500), behavior: 'smooth' })
        scheduleScan()
      } else if (message.mode !== 'refresh') return Promise.resolve({ ok: false, error: 'Unknown discovery action' })
      return Promise.resolve({ ok: true })
    }
    if (message?.type === 'xboost:collect-candidates') {
      for (const post of document.querySelectorAll(SELECTOR.post)) {
        const value = cached.get(post)
        if (value && scoredAt.get(post) === generation) offerCandidate(value.features, value.result)
      }
      return Promise.resolve({ ok: true })
    }
    if (message?.type === 'xboost:summary') {
      const counts = {}
      for (const post of document.querySelectorAll(SELECTOR.post)) {
        const value = cached.get(post)
        if (!value || scoredAt.get(post) !== generation || !settings.enabled) continue
        const result = value.result
        const reason = result.excluded ? result.reason : !result.scorable ? 'no scoring signals' : result.score >= settings.threshold ? 'highlighted' : 'below score threshold'
        counts[reason] = (counts[reason] || 0) + 1
      }
      return Promise.resolve({ counts })
    }
    if (!message || message.type !== 'xboost:rescan') return undefined
    generation += 1
    queue = []
    queued.clear()
    scheduleScan(true)
    return Promise.resolve({ ok: true })
  }

  function offerCandidate (features, result) {
    if (discoveryBinding) return
    if (!settings.enabled || result.excluded || !result.scorable || result.score < settings.threshold || !features.id || !features.handle || !features.text) return
    candidatePending.set(`${settings.profileId}:${features.id}`, {
      profileId: settings.profileId,
      post: { id: features.id, text: features.text, author: features.handle, postedAt: features.postedAt },
      features
    })
    scheduleCandidates()
  }

  function scheduleCandidates () {
    if (candidateTimer !== undefined || candidateSending || !candidatePending.size) return
    candidateTimer = window.setTimeout(() => {
      candidateTimer = undefined
      flushCandidates().catch(() => {})
    }, 80)
  }

  async function flushCandidates () {
    if (candidateSending || !candidatePending.size) return
    candidateSending = true
    const epoch = generation
    const entries = [...candidatePending.entries()].slice(0, 50)
    let delivered = false
    try {
      const response = await browser.runtime.sendMessage({ type: 'xboost:ai', action: 'candidate-batch', candidates: entries.map(([, value]) => value) })
      delivered = Boolean(response?.ok)
      if (delivered && epoch === generation) for (const [key] of entries) candidatePending.delete(key)
    } finally {
      candidateSending = false
      if (delivered) scheduleCandidates()
    }
  }

  function watchNavigation () {
    window.addEventListener('popstate', navigationTick)
    window.setInterval(() => {
      if (location.href !== lastUrl || (observedRoot && !observedRoot.isConnected)) navigationTick()
    }, URL_POLL_MS)
  }

  function navigationTick () {
    lastUrl = location.href
    discoverySent.clear()
    discoveryPending.clear()
    refreshDiscovery().catch(() => {})
    if (!settings.enabled) return
    ensureObserver()
    scheduleScan(true)
  }

  function yieldToBrowser () {
    return new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 120 })
      else setTimeout(resolve, 0)
    })
  }
})()
