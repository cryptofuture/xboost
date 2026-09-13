/* global browser */
'use strict'

const core = globalThis.XboostCore
const profiles = document.getElementById('profiles')
const status = document.getElementById('status')

async function renderProfiles () {
  const settings = await core.loadSettings()
  const state = (await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY]
  profiles.replaceChildren()
  for (const profile of core.profileDefinitions(state)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'profile-card'
    const name = document.createElement('strong')
    name.textContent = profile.name
    const blurb = document.createElement('span')
    blurb.className = 'profile-blurb'
    blurb.textContent = profile.blurb
    const keywords = document.createElement('span')
    keywords.className = 'profile-keywords'
    keywords.textContent = profile.keywords.join(' · ')
    button.classList.toggle('selected', profile.id === settings.profileId)
    button.setAttribute('aria-pressed', String(profile.id === settings.profileId))
    button.append(name, blurb, keywords)
    button.addEventListener('click', () => {
      ;(async () => {
        for (const card of profiles.querySelectorAll('.profile-card')) {
          const selected = card === button
          card.classList.toggle('selected', selected)
          card.setAttribute('aria-pressed', String(selected))
        }
        const settings = await core.switchProfile(profile.id)
        status.textContent = `${profile.name} is ready. Opening X search...`
        status.dataset.tone = 'ok'
        browser.tabs.create({ url: core.searchURL(settings) }).catch(showError)
      })().catch(showError)
    })
    profiles.append(button)
  }
}

document.getElementById('create-profile').addEventListener('click', () => browser.tabs.create({ url: browser.runtime.getURL('profiles.html?create=1&activate=1&return=welcome') }).catch(showError))
document.getElementById('custom').addEventListener('click', () => browser.tabs.create({ url: browser.runtime.getURL('profiles.html') }).catch(showError))
function showError (error) { status.textContent = error.message || 'Something went wrong.'; status.dataset.tone = 'error' }
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[core.PROFILE_KEY]) renderProfiles().catch(showError)
})
renderProfiles().catch(showError)
