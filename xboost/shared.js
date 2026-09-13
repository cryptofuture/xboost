/* global browser */

'use strict'

// Shared, dependency-free core used by the content script and extension pages.
// The scoring functions deliberately have no browser or DOM dependency so they
// are easy to test and always give the same answer for the same inputs.
globalThis.XboostCore = (() => {
  const STORAGE_KEY = 'xboost:settings'
  const PROFILE_KEY = 'xboost:profiles'

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    profileId: 'btcwid',
    requireKeywordMatch: false,
    keywords: [],
    blacklist: [],
    maxAgeMinutes: 1440,
    minViews: 0,
    maxReplies: 0,
    threshold: 50,
    targetViewsPerReply: 2000,
    freshnessWeight: 50,
    headroomWeight: 30,
    relevanceWeight: 20,
    dimOpacity: 35,
    dimNonMatches: false,
    intentBoost: true,
    showBadges: true,
    excludeReplies: false,
    excludePromoted: true,
    excludeEngagementBait: true
  })

  const PROFILES = Object.freeze([
    {
      id: 'btcwid',
      name: 'Bitcoin Monitor Widget',
      blurb: 'Market information workflows, dashboards, portfolio tracking and alerts.',
      keywords: ['crypto dashboard', 'trading dashboard', 'portfolio tracker', 'crypto portfolio', 'price alert', 'price alerts', 'market data', 'crypto research', 'trading terminal', 'Bitcoin price', 'crypto tools', 'trading tools']
    },
    {
      id: 'solana-index',
      name: 'Solana Index',
      blurb: 'Solana data, historical balances, accounting and indexing infrastructure.',
      keywords: ['Solana', 'SPL', 'Solana API', 'Solana data', 'historical balance', 'historical balances', 'historical data', 'token balance', 'blockchain accounting', 'crypto accounting', 'Solana RPC', 'indexer']
    },
    {
      id: 'outruna',
      name: 'Outruna',
      blurb: 'Telegram wallets, embedded wallets, security and stablecoin payments.',
      keywords: ['Telegram wallet', 'crypto wallet', 'EVM wallet', 'embedded wallet', 'wallet security', 'transaction simulation', 'transaction 2FA', 'stablecoin wallet', 'crypto payments', 'Privy', 'USDC', 'USDT']
    },
    {
      id: 'founder',
      name: 'Founder X account',
      blurb: 'Connect with technical solo founders and people building products.',
      keywords: ['solo founder', 'indie hacker', 'build in public', 'bootstrapped', 'pre-seed', 'fundraising', 'developer tools', 'open source', 'AI startup', 'crypto startup', 'founder journey', 'product launch']
    },
    {
      id: 'intent-ai-ops',
      name: 'Intent AI Ops',
      blurb: 'Infrastructure operations, DevOps, SRE and safe AI automation.',
      keywords: ['DevOps', 'SRE', 'Kubernetes', 'Linux', 'server management', 'infrastructure automation', 'AI agent', 'AI agents', 'AI DevOps', 'AI infrastructure', 'system administrator', 'OpenSSH']
    }
  ])

  const PROFILE_CONTEXT_EXAMPLE = `Product: Solana Index
Website: https://example.com
Purpose: Help developers query indexed Solana account and token history.

Current capabilities:
- Historical balance queries
- Indexed token-account data

Not currently available:
- Do not claim real-time trading or wallet custody.

Reply guidance:
- Answer technical questions directly.
- Mention the product only when relevant.
- Never invent pricing, traction, guarantees, integrations or security claims.`

  function profileDefinitions (state) {
    return Object.keys(state?.profiles || {}).map(id => {
      const base = PROFILES.find(profile => profile.id === id)
      const details = state.details?.[id]
      return {
        id,
        name: details?.name || base?.name || id,
        blurb: details?.blurb ?? base?.blurb ?? '',
        keywords: state.profiles[id]?.keywords || base?.keywords || [],
        builtIn: Boolean(base)
      }
    })
  }

  const ENGAGEMENT_BAIT = [
    /\bdrop your\b/i,
    /\bdrop a\s+\S+\s+(?:below|and)\b/i,
    /\bfollow me\b/i,
    /\bfollow back\b/i,
    /\bf4f\b/i,
    /\blike (?:and|&|\+) (?:rt|retweet|repost)\b/i,
    /\b(?:rt|retweet|repost) (?:and|&|\+) (?:like|follow)\b/i,
    /\bcomment (?:below|"|')/i,
    /\breply with (?:your|a|an)\b/i,
    /\btag (?:someone|a friend|3 people)\b/i,
    /\bwho wants (?:it|this|one)\b/i,
    /\bfirst \d+ (?:people|repliers|comments)\b/i,
    /\bgiveaway\b/i,
    /\benter to win\b/i,
    /\bengagement (?:bait|farm)\b/i,
    /\blike this (?:post|tweet) if\b/i,
    /\bboost this\b/i
  ]

  function coerceSettings (raw) {
    const input = raw && typeof raw === 'object' ? raw : {}
    return {
      enabled: booleanOr(input.enabled, DEFAULT_SETTINGS.enabled),
      profileId: typeof input.profileId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(input.profileId) ? input.profileId : 'btcwid',
      requireKeywordMatch: booleanOr(input.requireKeywordMatch, DEFAULT_SETTINGS.requireKeywordMatch),
      keywords: stringList(input.keywords, false),
      blacklist: stringList(input.blacklist, true),
      maxAgeMinutes: nonNegative(input.maxAgeMinutes, DEFAULT_SETTINGS.maxAgeMinutes),
      minViews: nonNegative(input.minViews, DEFAULT_SETTINGS.minViews),
      maxReplies: nonNegative(input.maxReplies, DEFAULT_SETTINGS.maxReplies),
      threshold: nonNegative(input.threshold, DEFAULT_SETTINGS.threshold),
      targetViewsPerReply: positive(input.targetViewsPerReply, DEFAULT_SETTINGS.targetViewsPerReply),
      freshnessWeight: nonNegative(input.freshnessWeight, DEFAULT_SETTINGS.freshnessWeight),
      headroomWeight: nonNegative(input.headroomWeight, DEFAULT_SETTINGS.headroomWeight),
      relevanceWeight: nonNegative(input.relevanceWeight, DEFAULT_SETTINGS.relevanceWeight),
      dimOpacity: clamp(nonNegative(input.dimOpacity, DEFAULT_SETTINGS.dimOpacity), 0, 100),
      dimNonMatches: booleanOr(input.dimNonMatches, DEFAULT_SETTINGS.dimNonMatches),
      intentBoost: booleanOr(input.intentBoost, DEFAULT_SETTINGS.intentBoost),
      showBadges: booleanOr(input.showBadges, DEFAULT_SETTINGS.showBadges),
      excludeReplies: booleanOr(input.excludeReplies, DEFAULT_SETTINGS.excludeReplies),
      excludePromoted: booleanOr(input.excludePromoted, DEFAULT_SETTINGS.excludePromoted),
      excludeEngagementBait: booleanOr(input.excludeEngagementBait, DEFAULT_SETTINGS.excludeEngagementBait)
    }
  }

  function booleanOr (value, fallback) {
    return typeof value === 'boolean' ? value : fallback
  }

  function nonNegative (value, fallback) {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
  }

  function positive (value, fallback) {
    const parsed = nonNegative(value, fallback)
    return parsed > 0 ? parsed : fallback
  }

  function clamp (value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function stringList (value, handles) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const result = []
    for (const item of value) {
      if (typeof item !== 'string') continue
      let clean = item.trim()
      if (handles) clean = clean.replace(/^@/, '').toLowerCase()
      if (!clean || seen.has(clean.toLowerCase())) continue
      seen.add(clean.toLowerCase())
      result.push(clean)
    }
    return result
  }

  function settingsFromProfile (profile, base) {
    return coerceSettings({
      ...base,
      profileId: profile.id,
      requireKeywordMatch: true,
      freshnessWeight: 35,
      headroomWeight: 20,
      relevanceWeight: 45,
      keywords: [...profile.keywords],
      maxAgeMinutes: DEFAULT_SETTINGS.maxAgeMinutes,
      minViews: DEFAULT_SETTINGS.minViews,
      maxReplies: DEFAULT_SETTINGS.maxReplies,
      threshold: 55
    })
  }

  async function loadSettings () {
    const stored = await browser.storage.local.get(STORAGE_KEY)
    if (!stored[STORAGE_KEY]?.profileId || stored[STORAGE_KEY]?.dimNonMatches === undefined) return command({ action: 'initialize' })
    return coerceSettings(stored[STORAGE_KEY])
  }

  async function saveSettings (settings) {
    return command({ action: 'save', settings })
  }

  async function command (payload) {
    const response = await browser.runtime.sendMessage({ type: 'xboost:profiles', ...payload })
    if (!response?.ok) throw new Error(response?.error || 'Could not update profiles')
    return response.settings
  }

  function switchProfile (profileId) {
    return command({ action: 'switch', profileId })
  }

  function setEnabled (enabled) {
    return command({ action: 'enable', enabled })
  }

  // Called only by the background queue, so simultaneous pages cannot overwrite
  // each other's profile edits or lose a pause/switch operation.
  async function updateProfiles (message) {
    const stored = await browser.storage.local.get([STORAGE_KEY, PROFILE_KEY])
    const previous = stored[STORAGE_KEY]
    const state = stored[PROFILE_KEY] || { activeId: 'btcwid', enabled: previous?.enabled !== false, profiles: {} }
    state.deletedDefaults = Array.isArray(state.deletedDefaults) ? state.deletedDefaults : []
    for (const profile of PROFILES) {
      if (!state.profiles[profile.id] && !state.deletedDefaults.includes(profile.id)) state.profiles[profile.id] = settingsFromProfile(profile, DEFAULT_SETTINGS)
    }
    state.details = state.details || {}
    if (!Object.hasOwn(state.profiles, state.activeId)) state.activeId = Object.keys(state.profiles)[0]
    if (!state.discoveryVersion) {
      if (stored[PROFILE_KEY]) await browser.storage.local.set({ 'xboost:pre-discovery-profiles': structuredClone(stored[PROFILE_KEY]) })
      for (const profile of Object.values(state.profiles)) {
        if (profile.maxAgeMinutes === 60) profile.maxAgeMinutes = 1440
        if (profile.maxReplies === 15) profile.maxReplies = 0
        profile.excludeReplies = false
        profile.dimNonMatches = false
        profile.intentBoost = true
      }
      state.discoveryVersion = 1
    }
    if (previous && !stored[PROFILE_KEY]) {
      // Preserve the old custom setup as a recoverable backup; named profiles
      // start with the user's requested product targeting.
      await browser.storage.local.set({ 'xboost:legacy-settings': previous })
    }
    if (message.action === 'switch') {
      if (!Object.hasOwn(state.profiles, message.profileId)) throw new Error('Unknown profile')
      state.activeId = message.profileId
    } else if (message.action === 'save') {
      const clean = coerceSettings(message.settings)
      if (!Object.hasOwn(state.profiles, clean.profileId)) throw new Error('Unknown profile')
      state.profiles[clean.profileId] = clean
      if (state.activeId === clean.profileId) state.enabled = clean.enabled
    } else if (message.action === 'save-profile') {
      if (!Object.hasOwn(state.profiles, message.profileId)) throw new Error('Unknown profile')
      const id = message.profileId
      const snapshot = JSON.stringify({ settings: state.profiles[id], details: state.details?.[id] || null })
      if (message.expected !== snapshot) throw new Error('This profile changed elsewhere. Reload it before saving to avoid losing changes.')
      const details = cleanDetails(message.details)
      state.details[id] = details
      state.profiles[id] = coerceSettings({ ...message.settings, profileId: id })
    } else if (message.action === 'create-profile') {
      const details = cleanDetails(message.details, true)
      const base = details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'profile'
      let id = base
      let suffix = 2
      while (Object.hasOwn(state.profiles, id) || PROFILES.some(profile => profile.id === id)) id = base + '-' + suffix++
      state.profiles[id] = coerceSettings({ ...settingsFromProfile({ id, keywords: [] }, DEFAULT_SETTINGS), ...message.settings, profileId: id })
      state.details[id] = details
      message.createdProfileId = id
    } else if (message.action === 'copy-profile') {
      const sourceId = message.profileId
      if (!Object.hasOwn(state.profiles, sourceId)) throw new Error('Unknown profile')
      const snapshot = JSON.stringify({ settings: state.profiles[sourceId], details: state.details[sourceId] || null })
      if (message.expected !== snapshot) throw new Error('This profile changed elsewhere. Reload it before copying.')
      const source = cleanDetails(message.details)
      const details = { ...source, name: source.name + ' copy' }
      const base = details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'profile-copy'
      let id = base
      let suffix = 2
      while (Object.hasOwn(state.profiles, id) || PROFILES.some(profile => profile.id === id)) id = base + '-' + suffix++
      state.profiles[id] = coerceSettings({ ...message.settings, profileId: id })
      state.details[id] = details
      message.createdProfileId = id
    } else if (message.action === 'delete-profile') {
      const id = message.profileId
      if (!Object.hasOwn(state.profiles, id)) throw new Error('Unknown profile')
      if (Object.keys(state.profiles).length <= 1) throw new Error('At least one profile is required')
      const snapshot = JSON.stringify({ settings: state.profiles[id], details: state.details[id] || null })
      if (message.expected !== snapshot) throw new Error('This profile changed elsewhere. Reload it before deleting.')
      delete state.profiles[id]
      delete state.details[id]
      if (PROFILES.some(profile => profile.id === id) && !state.deletedDefaults.includes(id)) state.deletedDefaults.push(id)
      if (state.activeId === id) state.activeId = Object.keys(state.profiles)[0]
      message.deletedProfileId = id
    } else if (message.action === 'add-keywords') {
      if (!Object.hasOwn(state.profiles, message.profileId)) throw new Error('Unknown profile')
      const profile = state.profiles[message.profileId]
      profile.keywords = stringList([...profile.keywords, ...stringList(message.keywords, false)], false)
    } else if (message.action === 'enable') {
      state.enabled = message.enabled === true
    }
    const active = coerceSettings({ ...state.profiles[state.activeId], enabled: state.enabled })
    await browser.storage.local.set({ [PROFILE_KEY]: state, [STORAGE_KEY]: active })
    return { ...active, ...(message.createdProfileId ? { createdProfileId: message.createdProfileId } : {}), ...(message.deletedProfileId ? { deletedProfileId: message.deletedProfileId } : {}) }
  }

  function cleanDetails (input, creating = false) {
    const handle = normaliseHandle(input?.handle)
    const context = typeof input?.context === 'string' ? input.context.trim() : ''
    if (typeof input?.name !== 'string' || !input.name.trim() || !handle || !/^[a-z0-9_]{1,15}$/.test(handle) || !context) throw new Error('Name, valid X profile URL or @name, and authoritative context are required')
    const normalize = value => value.replace(/\s+/g, ' ').trim().toLowerCase()
    if (creating && normalize(context) === normalize(PROFILE_CONTEXT_EXAMPLE)) throw new Error('Replace the Solana Index example with authoritative context for your own product')
    return { name: input.name.trim(), blurb: String(input.blurb || '').trim(), handle, context }
  }

  function parseCompactNumber (raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const match = /^([\d.,\s]+)\s*([kmb])?$/i.exec(raw.replace(/\u00a0/g, ' ').trim())
    if (!match) return null
    const digits = match[1].replace(/[\s,]/g, '')
    const base = Number(digits)
    if (!Number.isFinite(base)) return null
    const multiplier = { k: 1000, m: 1000000, b: 1000000000 }[(match[2] || '').toLowerCase()] || 1
    return Math.round(base * multiplier)
  }

  function parseMetricsLabel (label) {
    const result = { replies: null, reposts: null, likes: null, views: null }
    if (!label) return result
    const labels = {
      reply: 'replies',
      replies: 'replies',
      respuesta: 'replies',
      respuestas: 'replies',
      repost: 'reposts',
      reposts: 'reposts',
      retweet: 'reposts',
      retweets: 'reposts',
      like: 'likes',
      likes: 'likes',
      me_gusta: 'likes',
      view: 'views',
      views: 'views',
      visualizacion: 'views',
      visualizaciones: 'views'
    }
    const pattern = /([\d.,\s]*\d)\s*([kmb])?\s+([\p{L}_]+)/giu
    for (const match of label.normalize('NFD').replace(/\p{Diacritic}/gu, '').matchAll(pattern)) {
      const key = labels[match[3].toLowerCase()]
      const value = parseCompactNumber(`${match[1]}${match[2] || ''}`)
      if (key && value !== null && result[key] === null) result[key] = value
    }
    return result
  }

  function ageMinutesFromISO (iso, now = Date.now()) {
    if (!iso) return null
    const posted = Date.parse(iso)
    if (Number.isNaN(posted)) return null
    return Math.max(0, Math.round((now - posted) / 60000))
  }

  function normaliseHandle (raw) {
    if (!raw) return null
    const trimmed = String(raw).trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '')
    const handle = (trimmed.replace(/^@/, '').split(/[/?#\s]/)[0] || '').toLowerCase()
    return handle || null
  }

  function keywordMatches (text, keywords) {
    if (!keywords.length) return null
    const normalised = text.toLowerCase()
    if (!normalised) return []
    const matches = stringList(keywords, false).filter(keyword => keywordMatcher(keyword).test(normalised))
    // Contained variants are one signal: 'AI agent' + 'AI agents' and
    // 'Solana' + 'Solana RPC' must not inflate relevance.
    return matches.filter(keyword => !matches.some(other => other.length > keyword.length && other.toLowerCase().includes(keyword.toLowerCase())))
  }

  function keywordMatcher (keyword) {
    const clean = keyword.trim().toLowerCase()
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return /^[\p{L}\p{N}]+$/u.test(clean)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u')
      : new RegExp(escaped, 'u')
  }

  function freshnessScore (ageMinutes) {
    if (ageMinutes === null || !Number.isFinite(ageMinutes)) return null
    return Math.pow(0.5, Math.max(0, ageMinutes - 15) / 180)
  }

  function searchURL (settings, mode = 'conversations') {
    const profile = PROFILES.find(profile => profile.id === settings.profileId)
    const keywords = settings.keywords.length ? settings.keywords : profile?.keywords || []
    const terms = stringList(keywords, false).map(term => `"${term.replace(/["\\\r\n]/g, ' ').trim()}"`)
    const intent = mode === 'help' ? ' ("recommend" OR "looking for" OR "how do" OR "struggling" OR "help" OR "advice")' : ''
    return `https://x.com/search?${new URLSearchParams({ q: `(${terms.join(' OR ')})${intent}`, src: 'typed_query', f: 'live' })}`
  }

  function headroomScore (replies, views, maxReplies, targetViewsPerReply) {
    const replyCount = replies === null ? 0 : Math.max(0, replies)
    let replyRoom
    if (maxReplies > 0) {
      if (replyCount >= maxReplies) return 0
      replyRoom = 1 - replyCount / maxReplies
    } else {
      // With the reply cutoff disabled, use a smooth curve instead of a cap.
      replyRoom = 1 / (1 + replyCount / 10)
    }
    if (views === null || views <= 0) return replyRoom
    const ratio = views / (replyCount + 1)
    const viewEfficiency = clamp(Math.log10(Math.max(1, ratio)) / Math.log10(Math.max(10, targetViewsPerReply)), 0, 1)
    return 0.5 * replyRoom + 0.5 * viewEfficiency
  }

  function sharingInvitation (text) {
    const value = text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
    const invitation = /\b(?:share|drop|show|post|tell us)\b.{0,65}\b(?:what (?:you(?:'re| are)?|are you) building|what you're working on|your (?:project|product|startup|app|tool|repo|website|url|link)|(?:project|product|app|repo) (?:url|link))\b/i.test(value)
    const coercive = /\b(?:giveaway|follow me|follow back|f4f|tag (?:a friend|someone|\d)|like (?:and|&)|retweet|repost|boost this)\b/i.test(value)
    return invitation && !coercive && !/\blike\s*(?:and|&|\+)/i.test(value)
  }

  function solanaMemePromotion (text) {
    const value = String(text || '').replace(/\s+/g, ' ')
    const memeSignal = /\b(?:meme\s*coin|memecoin|pump\.?fun|moonshot|100x|1000x|degen|presale|fair launch|dogwifhat|bonk)\b|\$[a-z][a-z0-9]{1,9}\b/i.test(value)
    const promotionSignal = /\b(?:buy now|ape in|airdrop|presale|fair launch|launching|to the moon|next \d+x|hidden gem|holders?|contract address|dexscreener|raydium)\b|\b(?:ca|mint)\s*:/i.test(value)
    return memeSignal && promotionSignal
  }

  function exclusionFor (features, settings) {
    if (settings.excludeReplies && features.isReply) return 'reply'
    if (settings.excludePromoted && features.isPromoted) return 'promoted'
    if (features.handle && settings.blacklist.includes(features.handle)) return 'blacklisted author'
    if (settings.maxAgeMinutes > 0 && features.ageMinutes !== null && features.ageMinutes > settings.maxAgeMinutes) return 'older than your age filter'
    if (settings.minViews > 0 && features.views !== null && features.views < settings.minViews) return 'below your views filter'
    if (settings.profileId === 'solana-index' && solanaMemePromotion(features.text)) return 'Solana meme promotion'
    if (settings.excludeEngagementBait && !sharingInvitation(features.text) && ENGAGEMENT_BAIT.some(pattern => pattern.test(features.text.replace(/\s+/g, ' ')))) return 'engagement bait'
    return null
  }

  function scorePost (features, settings) {
    const exclusion = exclusionFor(features, settings)
    if (exclusion) return { score: 0, excluded: true, reason: exclusion, scorable: true, matches: null, breakdown: {} }

    const matches = keywordMatches(features.text, settings.keywords)
    const invitation = sharingInvitation(features.text)
    if (settings.requireKeywordMatch && matches !== null && matches.length === 0 && !invitation) {
      return { score: 0, excluded: true, reason: 'no keyword match', scorable: true, matches, breakdown: {} }
    }
    const signals = {
      freshness: { value: freshnessScore(features.ageMinutes), weight: settings.freshnessWeight },
      headroom: { value: headroomScore(features.replies, features.views, settings.maxReplies, settings.targetViewsPerReply), weight: settings.headroomWeight },
      relevance: { value: invitation ? Math.max(0.55, matches ? [0, 0.55, 0.85, 1][Math.min(3, matches.length)] : 0) : matches === null ? null : [0, 0.55, 0.85, 1][Math.min(3, matches.length)], weight: settings.relevanceWeight }
    }

    let weighted = 0
    let totalWeight = 0
    for (const signal of Object.values(signals)) {
      if (signal.value === null || signal.weight <= 0) continue
      weighted += clamp(signal.value, 0, 1) * signal.weight
      totalWeight += signal.weight
    }
    const intentBonus = settings.intentBoost && matches?.length > 0 && /\?|\b(?:recommend|recommendation|looking for|how do|struggling|need help|advice|any suggestions)\b/i.test(features.text) ? 10 : 0
    return {
      score: totalWeight > 0 ? Math.min(100, Math.round(100 * weighted / totalWeight) + intentBonus) : 0,
      intentBonus,
      invitation,
      excluded: false,
      reason: null,
      scorable: totalWeight > 0,
      matches,
      breakdown: signals
    }
  }

  function explainPost (features, result) {
    const age = features.ageMinutes === null
      ? 'age unknown'
      : features.ageMinutes < 1
        ? 'just posted'
        : features.ageMinutes < 60
          ? `${features.ageMinutes} min old`
          : `${Math.floor(features.ageMinutes / 60)} h old`
    const views = features.views === null ? 'views not shown' : `${features.views.toLocaleString()} views`
    const replies = `${(features.replies || 0).toLocaleString()} replies`
    const match = result.matches === null
      ? 'relevance skipped'
      : result.matches.length
        ? `matched: ${result.matches.slice(0, 6).join(', ')}`
        : 'no keyword match'
    return [age, views, replies, match, ...(result.invitation ? ['project-sharing invitation'] : []), ...(result.intentBonus ? ['help/question signal +10'] : [])].join(' · ')
  }

  return {
    STORAGE_KEY,
    PROFILE_KEY,
    DEFAULT_SETTINGS,
    PROFILES,
    PROFILE_CONTEXT_EXAMPLE,
    profileDefinitions,
    coerceSettings,
    settingsFromProfile,
    loadSettings,
    saveSettings,
    switchProfile,
    setEnabled,
    updateProfiles,
    searchURL,
    parseCompactNumber,
    parseMetricsLabel,
    ageMinutesFromISO,
    normaliseHandle,
    keywordMatches,
    sharingInvitation,
    solanaMemePromotion,
    freshnessScore,
    headroomScore,
    exclusionFor,
    scorePost,
    explainPost
  }
})()

if (typeof module !== 'undefined') module.exports = globalThis.XboostCore
