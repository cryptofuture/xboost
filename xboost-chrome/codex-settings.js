/* global browser */
'use strict'

;(function () {
  const el = id => document.getElementById(id)
  let configured = false
  let refreshing = false
  async function call (action, fields = {}) {
    const result = await browser.runtime.sendMessage({ type: 'xboost:ai', action, ...fields })
    if (!result?.ok) throw new Error(result?.error || 'Extension unavailable')
    return result.data
  }
  function error (value) { el('codex-status').textContent = value.message }
  async function refresh () {
    if (!configured || refreshing) return
    refreshing = true
    try {
      const data = await call('status')
      el('codex-status').textContent = data.account ? `Connected · Signed in (${data.account.planType || data.account.type})` : 'Connected · Sign in to Codex to enable AI'
      if (data.account) el('login-code').textContent = ''
    } finally { refreshing = false }
  }
  el('connect').addEventListener('click', () => {
    ;(async () => {
      const url = new URL(el('server-url').value)
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Use ws://SERVER-LAN-IP:4500 or wss://')
      const granted = await browser.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] })
      if (!granted) throw new Error('Server access was not granted')
      el('connect').disabled = true
      try {
        await call('save', { url: url.href, token: el('server-token').value })
        configured = true
        el('server-token').value = ''
        await refresh()
      } finally { el('connect').disabled = false }
    })().catch(error)
  })
  el('login').addEventListener('click', () => {
    call('login').then(data => {
      el('login-code').textContent = `Open ${data.verificationUrl} and enter ${data.userCode}. Status updates automatically.`
    }).catch(error)
  })
  call('config').then(config => {
    el('server-url').value = config.url
    configured = config.configured
    return refresh()
  }).catch(error)
  window.setInterval(() => { refresh().catch(error) }, 5000)
})()
