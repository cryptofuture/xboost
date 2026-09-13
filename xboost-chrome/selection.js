/* global browser */
'use strict'

globalThis.XboostSelection = (() => {
  function dialogStyle (dark) {
    const colors = dark
      ? { panel: '#101827', surface: '#0b1322', input: '#0a1120', border: '#26334a', strong: '#64748e', text: '#edf4ff', muted: '#91a1bb', primary: '#3269dd' }
      : { panel: '#ffffff', surface: '#f8fafd', input: '#ffffff', border: '#d7e2f0', strong: '#9cb5d6', text: '#102044', muted: '#61708a', primary: '#2563eb' }
    return `dialog{box-sizing:border-box;max-width:600px;width:85vw;max-height:80vh;overflow:auto;background:${colors.panel};color:${colors.text};border:1px solid ${colors.border};border-radius:14px;padding:22px;box-shadow:0 24px 80px #0a142866;font:14px/1.5 system-ui}dialog::backdrop{background:#0a142894}h2{margin:0 0 8px}p{color:${colors.muted};white-space:pre-wrap}textarea{box-sizing:border-box;width:100%;min-height:80px;padding:10px 12px;background:${colors.input};color:${colors.text};border:1px solid ${colors.border};border-radius:10px}button{min-height:38px;margin:12px 8px 0 0;padding:9px 16px;border:1px solid ${colors.border};border-radius:999px;background:${colors.surface};color:${colors.text};font-weight:700;cursor:pointer}button:hover{border-color:${colors.strong}}button.primary{border-color:${colors.primary};background:${colors.primary};color:#fff}button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid ${colors.primary};outline-offset:2px}button:disabled{opacity:.5;cursor:not-allowed}label{display:inline-block;padding:5px}fieldset{max-height:200px;overflow:auto;border:1px solid ${colors.border};border-radius:10px;background:${colors.surface}}`
  }

  function suggestions (text, existing = []) {
    const clean = text.replace(/https?:\/\/\S+/gi, '').replace(/@[\w]+/g, '')
    const tags = (clean.match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.slice(1))
    const stop = new Set('a an the this that these those i you we they it my your our their is are was were be been being to of for in on at with and or but so if as by from not just do does did have has had can could should would will about how what why when where who which more much very really today need want like get got use using looking anyone thanks please'.split(' '))
    const terms = [...tags]
    for (const sentence of clean.split(/[.!?\n,:;#]/)) {
      const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || []
      for (let index = 0; index < words.length; index++) {
        const word = words[index]
        if (word.length < 3 || stop.has(word.toLowerCase()) || /^\d+$/.test(word)) continue
        terms.push(word)
        const next = words[index + 1]
        if (next && next.length >= 3 && !stop.has(next.toLowerCase()) && !/^\d+$/.test(next)) terms.push(word + ' ' + next)
      }
    }
    const seen = new Set(existing.map(term => term.toLowerCase()))
    return terms.filter(term => {
      const key = term.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function open (features, settings) {
    document.querySelector('[data-xboost-selection-dialog]')?.remove()
    const profileId = settings.profileId
    const profile = globalThis.XboostCore.PROFILES.find(profile => profile.id === profileId)
    const host = document.createElement('div')
    host.setAttribute('data-xboost-selection-dialog', '')
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = dialogStyle(false)
    browser.storage.local.get('xboost:ui').then(data => {
      style.textContent = dialogStyle(data['xboost:ui']?.theme === 'dark')
    }).catch(() => {})
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', 'Select post for Xboost AI')
    const title = document.createElement('h2')
    title.textContent = `Select for ${profile?.name || profileId}`
    browser.storage.local.get(globalThis.XboostCore.PROFILE_KEY).then(data => {
      const name = data[globalThis.XboostCore.PROFILE_KEY]?.details?.[profileId]?.name
      if (name) title.textContent = `Select for ${name}`
    }).catch(() => {})
    const source = document.createElement('p')
    source.textContent = `@${features.handle}: ${features.text}`
    const notice = document.createElement('p')
    notice.textContent = 'Save this post locally for this profile. Drafting begins only while Auto-draft replies is enabled. Manual selections bypass score filters; your own accounts remain excluded. AI sends this post to your configured server and OpenAI.'
    const choices = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = 'Optional targeting suggestions (local text extraction, not AI). Choose only useful terms.'
    choices.append(legend)
    const checkboxes = []
    for (const term of suggestions(features.text, settings.keywords)) {
      const label = document.createElement('label')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.value = term
      checkboxes.push(checkbox)
      label.append(checkbox, document.createTextNode(term))
      choices.append(label)
    }
    const customLabel = document.createElement('label')
    customLabel.textContent = 'Additional keywords or phrases, one per line'
    const custom = document.createElement('textarea')
    customLabel.append(custom)
    const help = document.createElement('p')
    help.textContent = 'Selected terms are added to this profile for future searches and scoring. Hashtags are suggested without # so plain-text mentions also match. Nothing is added unless you select or enter it. Existing search tabs keep their original query; open a new profile search to use updated keywords.'
    const status = document.createElement('p')
    status.setAttribute('role', 'status')
    const save = document.createElement('button')
    save.className = 'primary'
    save.textContent = 'Select post & save chosen keywords'
    const close = document.createElement('button')
    close.textContent = 'Cancel'
    close.onclick = () => { dialog.close(); host.remove() }
    dialog.addEventListener('cancel', () => host.remove())
    save.onclick = async () => {
      save.disabled = true
      try {
        const result = await browser.runtime.sendMessage({ type: 'xboost:ai', action: 'manual-select', profileId, post: { id: features.id, author: features.handle, text: features.text, postedAt: features.postedAt } })
        if (!result?.ok || result.data?.ignored) throw new Error(result?.error || 'This post cannot be selected (owned accounts are excluded).')
        const keywords = [...checkboxes.filter(box => box.checked).map(box => box.value), ...custom.value.split('\n').map(value => value.trim()).filter(Boolean)]
        if (keywords.length) {
          const updated = await browser.runtime.sendMessage({ type: 'xboost:profiles', action: 'add-keywords', profileId, keywords })
          if (!updated?.ok) throw new Error('Post saved, but keywords could not be saved. Try again: ' + (updated?.error || 'Unknown error'))
        }
        status.textContent = result.data.duplicate ? 'Post already exists in this profile’s AI list. Chosen keywords saved. For skipped/failed drafts, use Retry in the AI panel.' : 'Selected and saved. Open AI replies to review the queue; enable Auto-draft replies to process it.'
        close.textContent = 'Done'
      } catch (error) { status.textContent = error.message } finally { save.disabled = false }
    }
    dialog.append(title, source, notice, choices, customLabel, help, save, close, status)
    root.append(style, dialog)
    document.documentElement.append(host)
    dialog.showModal()
  }
  return { suggestions, open }
})()
if (typeof module !== 'undefined') module.exports = globalThis.XboostSelection
