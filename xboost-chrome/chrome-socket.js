/* global chrome */
'use strict'

const hosts = []
const proxies = new Map()

globalThis.xboostChromeSocketHostTabId = () => hosts.at(-1)?.sender?.tab?.id

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'xboost:codex-socket-host' || !['options.html', 'ai.html'].some(page => port.sender?.url === chrome.runtime.getURL(page))) return
  hosts.push(port)
  port.onMessage.addListener(message => {
    const socket = proxies.get(message.id)
    if (!socket || socket.port !== port) return
    if (message.type === 'open') { socket.readyState = 1; socket.onopen?.() }
    if (message.type === 'message') socket.onmessage?.({ data: message.data })
    if (message.type === 'error') socket.onerror?.()
    if (message.type === 'close') {
      proxies.delete(message.id)
      socket.readyState = 3
      socket.onclose?.({ code: message.code, reason: message.reason })
    }
  })
  port.onDisconnect.addListener(() => {
    hosts.splice(hosts.indexOf(port), 1)
    for (const [id, socket] of proxies) {
      if (socket.port !== port) continue
      proxies.delete(id)
      socket.readyState = 3
      socket.onclose?.({ code: 1006, reason: 'Chrome socket host closed' })
    }
  })
})

globalThis.xboostChromeSocket = url => {
  const port = hosts.at(-1)
  if (!port) throw new Error('Keep Xboost Settings or AI replies open while connecting to Codex')
  const id = crypto.randomUUID()
  const socket = {
    port,
    readyState: 0,
    send: data => port.postMessage({ type: 'send', id, data }),
    close: () => port.postMessage({ type: 'close', id })
  }
  proxies.set(id, socket)
  port.postMessage({ type: 'open', id, url })
  return socket
}
