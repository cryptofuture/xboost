/* global browser */

'use strict'

const core = globalThis.XboostCore
const theme = globalThis.XboostTheme

const ids = [
  'enabled', 'enabled-hint', 'keywords', 'blacklist', 'maxAgeMinutes', 'minViews',
  'maxReplies', 'threshold', 'targetViewsPerReply', 'freshnessWeight',
  'headroomWeight', 'relevanceWeight', 'dimOpacity', 'showBadges',
  'excludeReplies', 'excludePromoted', 'excludeEngagementBait', 'profiles', 'save',
  'reset', 'save-status', 'requireKeywordMatch', 'dimNonMatches', 'intentBoost',
  'about-visibility', 'about-visibility-status', 'dark-theme', 'theme-status',
  'support-dialog', 'support-confirmation', 'confirm-hide-about', 'cancel-hide-about'
]
const el = Object.fromEntries(ids.map(id => [id, byId(id)]))
let currentProfileId = 'btcwid'
let dirty = false
let busy = false
const ABOUT_KEY = theme.KEY
let aboutHidden = false
async function refreshAboutVisibility () {
  const data = await browser.storage.local.get(ABOUT_KEY)
  aboutHidden = data[ABOUT_KEY]?.hideAbout === true
  el['about-visibility'].textContent = aboutHidden ? 'Show About Xboost button' : 'Hide About Xboost button'
  el['about-visibility'].classList.toggle('about-button', !aboutHidden)
  el['about-visibility-status'].textContent = aboutHidden ? 'Hidden from the popup.' : 'Visible in the popup.'
}
async function refreshTheme () {
  const selected = await theme.load()
  el['dark-theme'].checked = selected === theme.DARK
  el['theme-status'].textContent = selected === theme.DARK ? 'Ocean Signal is active.' : 'Arctic Daylight is active.'
}
async function refreshCards () {
  const state = (await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY]
  el.profiles.replaceChildren()
  for (const profile of core.profileDefinitions(state)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'profile-card'
    button.dataset.profile = profile.id
    const name = document.createElement('strong')
    name.textContent = profile.name
    const blurb = document.createElement('span')
    blurb.className = 'profile-blurb'
    blurb.textContent = profile.blurb
    const keywords = document.createElement('span')
    keywords.className = 'profile-keywords'
    keywords.textContent = profile.keywords.join(' · ')
    button.append(name, blurb, keywords)
    button.classList.toggle('selected', profile.id === currentProfileId)
    button.setAttribute('aria-pressed', String(profile.id === currentProfileId))
    button.addEventListener('click', () => switchTo(profile))
    el.profiles.append(button)
  }
}
function switchTo (profile) {
  if (busy) return
  busy = true
  ;(async () => {
    if (dirty) await core.saveSettings(collect())
    render(await core.switchProfile(profile.id))
    status(`${profile.name} is active across your open timelines.`, 'ok')
  })().catch(error => status(error.message, 'error')).finally(() => { busy = false })
}
document.addEventListener('input', event => {
  if (![el['dark-theme'], el['support-confirmation']].includes(event.target)) dirty = true
})

function byId (id) {
  const node = document.getElementById(id)
  if (!node) throw new Error(`options.html is missing #${id}`)
  return node
}

function render (settings) {
  currentProfileId = settings.profileId
  dirty = false
  for (const card of el.profiles.querySelectorAll('.profile-card')) {
    const selected = card.dataset.profile === currentProfileId
    card.classList.toggle('selected', selected)
    card.setAttribute('aria-pressed', String(selected))
  }
  for (const key of ['enabled', 'showBadges', 'excludeReplies', 'excludePromoted', 'excludeEngagementBait', 'requireKeywordMatch', 'dimNonMatches', 'intentBoost']) {
    el[key].checked = settings[key]
  }
  for (const key of ['maxAgeMinutes', 'minViews', 'maxReplies', 'threshold', 'targetViewsPerReply', 'freshnessWeight', 'headroomWeight', 'relevanceWeight', 'dimOpacity']) {
    el[key].value = String(settings[key])
  }
  el.keywords.value = settings.keywords.join('\n')
  el.blacklist.value = settings.blacklist.join('\n')
  renderEnabled()
}

function collect () {
  return core.coerceSettings({
    profileId: currentProfileId,
    requireKeywordMatch: el.requireKeywordMatch.checked,
    dimNonMatches: el.dimNonMatches.checked,
    intentBoost: el.intentBoost.checked,
    enabled: el.enabled.checked,
    keywords: splitEntries(el.keywords.value),
    blacklist: splitEntries(el.blacklist.value),
    maxAgeMinutes: Number(el.maxAgeMinutes.value),
    minViews: Number(el.minViews.value),
    maxReplies: Number(el.maxReplies.value),
    threshold: Number(el.threshold.value),
    targetViewsPerReply: Number(el.targetViewsPerReply.value),
    freshnessWeight: Number(el.freshnessWeight.value),
    headroomWeight: Number(el.headroomWeight.value),
    relevanceWeight: Number(el.relevanceWeight.value),
    dimOpacity: Number(el.dimOpacity.value),
    showBadges: el.showBadges.checked,
    excludeReplies: el.excludeReplies.checked,
    excludePromoted: el.excludePromoted.checked,
    excludeEngagementBait: el.excludeEngagementBait.checked
  })
}

function splitEntries (value) {
  return value.split(/[\n,]/).map(value => value.trim()).filter(Boolean)
}

function renderEnabled () {
  el['enabled-hint'].textContent = el.enabled.checked
    ? 'Every visible post is scored as you scroll.'
    : 'Paused. Existing Xboost decoration is removed.'
}

function status (message, tone = 'muted') {
  el['save-status'].textContent = message
  el['save-status'].dataset.tone = tone
}

el.enabled.addEventListener('change', renderEnabled)

el['dark-theme'].addEventListener('change', () => {
  theme.save(el['dark-theme'].checked ? theme.DARK : theme.LIGHT).then(refreshTheme).catch(error => {
    el['theme-status'].textContent = error.message
  })
})

async function saveAboutVisibility (hideAbout) {
  const stored = (await browser.storage.local.get(ABOUT_KEY))[ABOUT_KEY] || {}
  await browser.storage.local.set({ [ABOUT_KEY]: { ...stored, hideAbout } })
  await refreshAboutVisibility()
}

el['about-visibility'].addEventListener('click', () => {
  if (aboutHidden) {
    saveAboutVisibility(false).catch(error => { el['about-visibility-status'].textContent = error.message })
    return
  }
  el['support-confirmation'].checked = false
  el['confirm-hide-about'].disabled = true
  el['support-dialog'].showModal()
})
el['support-confirmation'].addEventListener('change', () => {
  el['confirm-hide-about'].disabled = !el['support-confirmation'].checked
})
el['cancel-hide-about'].addEventListener('click', () => el['support-dialog'].close())
el['confirm-hide-about'].addEventListener('click', () => {
  if (!el['support-confirmation'].checked) return
  el['confirm-hide-about'].disabled = true
  saveAboutVisibility(true).then(() => el['support-dialog'].close()).catch(error => {
    el['about-visibility-status'].textContent = error.message
    el['confirm-hide-about'].disabled = false
  })
})

el.save.addEventListener('click', () => {
  if (busy) return
  busy = true
  ;(async () => {
    const saved = await core.saveSettings(collect())
    render(saved)
    status('Saved. Open timelines update automatically.', 'ok')
    window.setTimeout(() => status(''), 3500)
  })().catch(error => status(`Could not save: ${error.message}`, 'error')).finally(() => { busy = false })
})

el.reset.addEventListener('click', () => {
  if (busy) return
  ;(async () => {
    const state = (await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY]
    const profile = core.profileDefinitions(state).find(profile => profile.id === currentProfileId)
    render(core.settingsFromProfile(profile, { ...core.DEFAULT_SETTINGS, enabled: el.enabled.checked }))
    dirty = true
    status('Profile defaults loaded. Save to apply them.')
  })().catch(error => status(error.message, 'error'))
})

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ABOUT_KEY]) {
    refreshAboutVisibility().catch(error => status(error.message, 'error'))
    refreshTheme().catch(error => { el['theme-status'].textContent = error.message })
  }
  if (area === 'local' && changes[core.PROFILE_KEY]) refreshCards().catch(error => status(error.message, 'error'))
  if (area !== 'local' || !changes[core.STORAGE_KEY] || busy) return
  if (dirty) {
    status('The active profile changed elsewhere. Your draft is preserved; Save stores it in its original profile.')
  } else render(core.coerceSettings(changes[core.STORAGE_KEY].newValue))
})

;(async () => { render(await core.loadSettings()); await refreshCards(); await refreshAboutVisibility(); await refreshTheme() })().catch(error => status(`Could not load settings: ${error.message}`, 'error'))
