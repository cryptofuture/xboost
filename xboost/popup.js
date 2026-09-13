/* global browser */

'use strict'

const core = globalThis.XboostCore
const ABOUT_KEY = 'xboost:ui'
const aboutButton = document.getElementById('about')
async function refreshAboutVisibility () {
  const data = await browser.storage.local.get(ABOUT_KEY)
  aboutButton.hidden = data[ABOUT_KEY]?.hideAbout === true
}
aboutButton.addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('about.html') }).catch(showError)
})
document.getElementById('engagement-review').onclick = () => browser.tabs.create({ url: 'https://x.com/notifications' }).catch(showError)
document.getElementById('profile-editor').addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('profiles.html') }).catch(showError)
})
async function refreshProfileNames () {
  const stored = (await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY]
  const selected = current?.profileId || stored.activeId
  picker.replaceChildren()
  for (const profile of core.profileDefinitions(stored)) {
    const option = document.createElement('option')
    option.value = profile.id
    option.textContent = profile.name
    picker.append(option)
  }
  picker.value = selected
}
document.getElementById('ai-replies').addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('ai.html') }).catch(showError)
})
const enabled = document.getElementById('enabled')
const state = document.getElementById('state')
const keywordCount = document.getElementById('keyword-count')
const threshold = document.getElementById('threshold')
const warning = document.getElementById('keyword-warning')
const popupStatus = document.getElementById('status')
let current = null
const searchButton = document.getElementById('find-conversations')
searchButton.addEventListener('click', () => {
  if (!current) return
  browser.tabs.create({ url: core.searchURL(current, document.getElementById('search-mode').value) }).catch(showError)
})

async function refreshSummary () {
  const node = document.getElementById('scan-summary')
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const { counts } = await browser.tabs.sendMessage(tab.id, { type: 'xboost:summary' })
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    node.textContent = total ? `${total} posts evaluated on this page: ${Object.entries(counts).map(([reason, count]) => `${count} ${reason}`).join(' · ')}` : 'No posts evaluated yet, or Xboost is paused.'
  } catch {
    node.textContent = 'Search X to discover posts beyond your existing feed.'
  }
}
window.setInterval(() => { refreshSummary().catch(showError) }, 1500)
refreshSummary().catch(showError)
const picker = document.getElementById('active-profile')
picker.addEventListener('change', () => {
  picker.disabled = true
  core.switchProfile(picker.value).then(render).catch(error => {
    render(current)
    showError(error)
  })
})
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ABOUT_KEY]) refreshAboutVisibility().catch(showError)
  if (area === 'local' && changes[core.PROFILE_KEY]) refreshProfileNames().catch(showError)
  if (area === 'local' && changes[core.STORAGE_KEY]) render(core.coerceSettings(changes[core.STORAGE_KEY].newValue))
})

function render (settings) {
  current = settings
  searchButton.disabled = false
  picker.value = settings.profileId
  picker.disabled = false
  enabled.checked = settings.enabled
  enabled.disabled = false
  state.textContent = settings.enabled ? 'Active' : 'Paused'
  state.dataset.tone = settings.enabled ? 'ok' : 'off'
  keywordCount.textContent = settings.keywords.length ? String(settings.keywords.length) : 'None'
  threshold.textContent = `${settings.threshold}+`
  warning.hidden = settings.keywords.length > 0
}

enabled.addEventListener('change', () => {
  if (!current) return
  core.setEnabled(enabled.checked).then(render).catch(showError)
})

document.getElementById('settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage().catch(showError)
})

document.getElementById('add-keywords').addEventListener('click', () => {
  browser.tabs.create({ url: `${browser.runtime.getURL('options.html')}#interests` }).catch(showError)
})

document.getElementById('rescan').addEventListener('click', () => {
  ;(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (typeof tab?.id !== 'number') return
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'xboost:rescan' })
      popupStatus.textContent = 'Rescan scheduled.'
      popupStatus.dataset.tone = 'ok'
    } catch {
      popupStatus.textContent = 'Open an X timeline to rescan.'
      popupStatus.dataset.tone = 'muted'
    }
  })().catch(showError)
})

function showError (error) {
  popupStatus.textContent = error.message || 'Something went wrong.'
  popupStatus.dataset.tone = 'off'
}

;(async () => { await refreshAboutVisibility(); render(await core.loadSettings()); await refreshProfileNames() })().catch(showError)
