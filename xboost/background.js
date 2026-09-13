/* global browser */

'use strict'

const X_URLS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*'
]

let profileQueue = Promise.resolve()
const profileEditorURL = browser.runtime.getURL('profiles.html')
function isProfileEditor (sender) {
  const url = sender?.url
  return typeof url === 'string' && (url === profileEditorURL || url.startsWith(profileEditorURL + '?') || url.startsWith(profileEditorURL + '#'))
}
globalThis.xboostProfileCommand = message => {
  const task = profileQueue.then(() => globalThis.XboostCore.updateProfiles(message))
  profileQueue = task.catch(() => {})
  return task
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'xboost:profiles') return undefined
  if (['save-profile', 'create-profile', 'copy-profile', 'delete-profile'].includes(message.action) && !isProfileEditor(sender)) return Promise.resolve({ ok: false, error: 'Profile editor required' })
  const task = globalThis.xboostProfileCommand(message)
  return task.then(settings => ({ ok: true, settings }), error => ({ ok: false, error: error.message }))
})

browser.runtime.onInstalled.addListener(details => {
  if (details.reason !== 'install') return
  browser.tabs.create({ url: browser.runtime.getURL('welcome.html') }).catch(reportError)
  injectIntoExistingTabs().catch(reportError)
})

function reportError (error) {
  console.error('[xboost] Background task failed', error)
}

async function injectIntoExistingTabs () {
  const tabs = await browser.tabs.query({ url: X_URLS })
  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue
    try {
      await browser.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      })
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['shared.js', 'selection.js', 'content.js', 'assisted-reply.js']
      })
    } catch (error) {
      console.warn('[xboost] Could not initialize an existing tab', tab.id, error)
    }
  }
}
