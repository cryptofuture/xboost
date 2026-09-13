/* global chrome */
'use strict'

// Chrome APIs return promises, but asynchronous message listeners need sendResponse.
if (!globalThis.browser) {
  const listeners = new Map()
  const onMessage = {
    addListener (listener) {
      const wrapped = (message, sender, respond) => {
        const result = listener(message, sender)
        if (result && typeof result.then === 'function') {
          result.then(respond, error => respond({ ok: false, error: error.message }))
          return true
        }
        if (result !== undefined) respond(result)
        return false
      }
      listeners.set(listener, wrapped)
      chrome.runtime.onMessage.addListener(wrapped)
    },
    removeListener (listener) {
      chrome.runtime.onMessage.removeListener(listeners.get(listener))
      listeners.delete(listener)
    }
  }
  globalThis.browser = { ...chrome, runtime: { ...chrome.runtime, onMessage } }
}
