/* global chrome */
'use strict'

globalThis.xboostInstallAuth = async target => {
  if (!Number.isInteger(target.tabId)) throw new Error('Open Xboost Settings or AI replies in a browser tab before connecting')
  const escaped = target.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'authorization', operation: 'set', value: `Bearer ${target.token}` },
          { header: 'origin', operation: 'remove' }
        ]
      },
      condition: {
        regexFilter: '^' + escaped + '$',
        isUrlFilterCaseSensitive: true,
        tabIds: [target.tabId],
        resourceTypes: ['websocket']
      }
    }]
  })
}
