/* global browser */
'use strict'

const core = globalThis.XboostCore
const replies = globalThis.XboostReplies
const dialogs = globalThis.XboostDialog
const el = id => document.getElementById(id)
const pageParams = new URLSearchParams(window.location.search)
const returnToWelcome = pageParams.get('return') === 'welcome'
let profileId
let expected
let settings
let state
let dirty = false
let busy = false
let wizardStep = 1
const inputs = new Map()
function status (message) { el('profile-status').textContent = message }
function labelFor (key) { return key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()) }
for (const [key, value] of Object.entries(core.DEFAULT_SETTINGS)) {
  if (['enabled', 'profileId'].includes(key)) continue
  const label = document.createElement('label')
  label.className = typeof value === 'boolean' ? 'check' : 'field'
  const input = document.createElement(Array.isArray(value) ? 'textarea' : 'input')
  if (!Array.isArray(value)) input.type = typeof value === 'boolean' ? 'checkbox' : 'number'
  else input.rows = 5
  if (input.type === 'number') { input.min = key === 'targetViewsPerReply' ? '1' : '0'; input.step = 'any' }
  if (key === 'dimOpacity') input.max = '100'
  input.setAttribute('aria-label', labelFor(key))
  label.append(document.createTextNode(labelFor(key) + (Array.isArray(value) ? ' (one per line)' : '')), input)
  el('targeting-fields').append(label)
  inputs.set(key, input)
}
async function bundled (id) {
  const account = replies.ACCOUNTS[id]
  if (!account?.file) return state.details?.[id]?.context || 'Account owner: Eugene Gusev (@quellemor). No biography or personal experience claims have been supplied. Do not invent either. Respond constructively without forcing a product promotion.'
  const response = await fetch(browser.runtime.getURL('products/' + account.file))
  if (!response.ok) throw new Error('Bundled context could not be loaded')
  return response.text()
}
async function readState () {
  state = (await browser.storage.local.get(core.PROFILE_KEY))[core.PROFILE_KEY]
  return state
}
function refreshPicker (selected) {
  const definitions = core.profileDefinitions(state)
  el('profile-picker').replaceChildren()
  for (const profile of definitions) {
    const option = document.createElement('option')
    option.value = profile.id
    option.textContent = profile.name
    el('profile-picker').append(option)
  }
  el('profile-picker').value = selected
  el('delete-profile').disabled = definitions.length <= 1
}
async function load (id) {
  await readState()
  const definition = core.profileDefinitions(state).find(profile => profile.id === id)
  if (!definition) throw new Error('Profile no longer exists')
  const account = replies.ACCOUNTS[id]
  const details = state.details?.[id]
  settings = state.profiles[id]
  profileId = id
  expected = JSON.stringify({ settings, details: details || null })
  refreshPicker(id)
  el('profile-name').value = definition.name
  el('profile-blurb').value = definition.blurb
  el('profile-handle').value = details?.handle || account?.handle || ''
  el('profile-context').value = details?.context ?? await bundled(id)
  el('bundled-context').hidden = !account?.file
  for (const [key, input] of inputs) {
    if (input.type === 'checkbox') input.checked = settings[key]
    else input.value = Array.isArray(settings[key]) ? settings[key].join('\n') : settings[key]
  }
  dirty = false
  status('Loaded. Changes are saved only when you click Save profile.')
}
async function run (task) {
  if (busy) return
  busy = true
  el('profile-picker').disabled = true
  try { await task() } catch (error) { status(error.message); el('wizard-status').textContent = error.message } finally { busy = false; el('profile-picker').disabled = false }
}
function detailsFromForm () { return { name: el('profile-name').value, blurb: el('profile-blurb').value, handle: el('profile-handle').value, context: el('profile-context').value } }
function settingsFromForm () {
  const updated = { ...settings }
  for (const [key, input] of inputs) updated[key] = input.type === 'checkbox' ? input.checked : Array.isArray(core.DEFAULT_SETTINGS[key]) ? input.value.split('\n') : Number(input.value)
  return updated
}
function contextPrompt () {
  const name = el('new-name').value.trim() || '[PRODUCT NAME]'
  const blurb = el('new-blurb').value.trim() || '[WHAT THE PRODUCT DOES]'
  return `Create an authoritative AI context document for ${name}.

Product summary supplied by me: ${blurb}

Organize only verified information I provide under sections such as purpose, intended users, current capabilities, limitations, security boundaries, website and official repository, pricing, and reply guidance. Clearly separate current features from planned ideas. Do not invent capabilities, pricing, traction, customers, integrations, guarantees, URLs or security claims. Mark missing facts as questions for me instead of filling them in. The result will be used to draft concise public X replies, so include rules for when the product should and should not be mentioned. Return the context document only.`
}
function showWizardStep (step) {
  wizardStep = step
  for (let index = 1; index <= 3; index++) el('wizard-step-' + index).hidden = index !== step
  el('wizard-progress').textContent = `(${step}/3)`
  el('wizard-back').hidden = step === 1
  el('wizard-next').hidden = step === 3
  el('wizard-create').hidden = step !== 3
  el('context-prompt').value = contextPrompt()
}
function closeWizard () { el('create-wizard').hidden = true; el('profile-form').hidden = false; el('profile-selector').hidden = false; el('wizard-status').textContent = '' }
function confirmAction (title, message, confirmLabel = 'Confirm', danger = false) {
  return dialogs.confirm({ title, message, confirmLabel, danger })
}
async function goToWelcome () {
  if (dirty && !await confirmAction('Leave Profile editor?', 'Your unsaved profile changes will be discarded.', 'Leave')) return
  window.location.assign(browser.runtime.getURL('welcome.html'))
}
async function showCreateWizard () {
  if (dirty) await load(profileId)
  el('profile-form').hidden = true
  el('profile-selector').hidden = true
  el('create-wizard').hidden = false
  el('new-name').value = ''
  el('new-blurb').value = ''
  el('new-handle').value = ''
  el('new-context').value = core.PROFILE_CONTEXT_EXAMPLE
  el('new-keywords').value = ''
  showWizardStep(1)
}
el('profile-form').addEventListener('input', () => { dirty = true })
el('back-welcome').onclick = () => { goToWelcome().catch(error => status(error.message)) }
el('profile-picker').addEventListener('change', async () => {
  const next = el('profile-picker').value
  if (dirty && !await confirmAction('Switch profiles?', 'Your unsaved changes to this profile will be discarded.', 'Discard and switch')) { el('profile-picker').value = profileId; return }
  run(() => load(next))
})
el('reload-profile').onclick = async () => {
  if (!dirty || await confirmAction('Discard profile changes?', 'Reloading restores the last saved version of this profile.', 'Discard changes')) run(() => load(profileId))
}
el('bundled-context').onclick = () => run(async () => {
  if (!await confirmAction('Load bundled context?', 'This replaces the context in the form. You must still save the profile to apply it.', 'Replace context')) return
  el('profile-context').value = await bundled(profileId)
  dirty = true
})
el('profile-form').addEventListener('submit', event => {
  event.preventDefault()
  run(async () => {
    const response = await browser.runtime.sendMessage({ type: 'xboost:profiles', action: 'save-profile', profileId, expected, settings: settingsFromForm(), details: detailsFromForm() })
    if (!response?.ok) throw new Error(response?.error || 'Profile could not be saved')
    await load(profileId)
    status('Saved. Open pages rescore automatically; new searches use the updated keywords.')
  })
})
el('new-profile').onclick = async () => {
  if (dirty && !await confirmAction('Create a new profile?', 'Your unsaved changes to the current profile will be discarded.', 'Discard and continue')) return
  run(showCreateWizard)
}
el('wizard-cancel').onclick = closeWizard
el('wizard-back').onclick = () => showWizardStep(Math.max(1, wizardStep - 1))
el('wizard-next').onclick = () => {
  if (wizardStep === 1 && (!el('new-name').value.trim() || !el('new-handle').value.trim())) { el('wizard-status').textContent = 'Enter a name and X profile URL or @name.'; return }
  const normalized = value => value.replace(/\s+/g, ' ').trim().toLowerCase()
  if (wizardStep === 2 && (!el('new-context').value.trim() || normalized(el('new-context').value) === normalized(core.PROFILE_CONTEXT_EXAMPLE))) { el('wizard-status').textContent = 'Replace the Solana Index example with authoritative context for your own product.'; return }
  el('wizard-status').textContent = ''
  showWizardStep(Math.min(3, wizardStep + 1))
}
for (const id of ['new-name', 'new-blurb']) el(id).addEventListener('input', () => { el('context-prompt').value = contextPrompt() })
el('copy-context-prompt').onclick = () => navigator.clipboard.writeText(el('context-prompt').value).then(() => { el('wizard-status').textContent = 'AI prompt copied.' }).catch(error => { el('wizard-status').textContent = error.message })
el('wizard-create').onclick = () => run(async () => {
  const response = await browser.runtime.sendMessage({ type: 'xboost:profiles', action: 'create-profile', details: { name: el('new-name').value, blurb: el('new-blurb').value, handle: el('new-handle').value, context: el('new-context').value }, settings: { keywords: el('new-keywords').value.split('\n') } })
  if (!response?.ok) throw new Error(response?.error || 'Profile could not be created')
  closeWizard()
  await load(response.settings.createdProfileId)
  const activate = pageParams.get('activate') === '1'
  if (activate) await core.switchProfile(response.settings.createdProfileId)
  if (returnToWelcome) {
    window.location.assign(browser.runtime.getURL('welcome.html'))
    return
  }
  status(activate ? 'Profile created and selected. Use Back to Welcome to open its X search.' : 'Profile created. It is ready for editing and selection.')
})
el('copy-profile').onclick = () => run(async () => {
  const response = await browser.runtime.sendMessage({ type: 'xboost:profiles', action: 'copy-profile', profileId, expected, settings: settingsFromForm(), details: detailsFromForm() })
  if (!response?.ok) throw new Error(response?.error || 'Profile could not be copied')
  await load(response.settings.createdProfileId)
  status('Profile copied. The copy is separate and ready to edit.')
})
el('delete-profile').onclick = async () => {
  const name = el('profile-name').value.trim() || profileId
  if (!await confirmAction(`Delete "${name}"?`, 'Its profile settings cannot be restored. Existing drafts and reply history will remain.', 'Delete profile', true)) return
  run(async () => {
    const response = await browser.runtime.sendMessage({ type: 'xboost:profiles', action: 'delete-profile', profileId, expected })
    if (!response?.ok) throw new Error(response?.error || 'Profile could not be deleted')
    await readState()
    await load(state.activeId)
    status('Profile deleted. Existing drafts and reply history were preserved.')
  })
}
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
run(async () => {
  const active = await core.loadSettings()
  await load(active.profileId)
  if (pageParams.get('create') === '1') await showCreateWizard()
})
