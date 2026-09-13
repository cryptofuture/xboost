/* global chrome, WebSocket */
'use strict'

const port = chrome.runtime.connect({ name: 'xboost:codex-socket-host' })
const sockets = new Map()

port.onMessage.addListener(message => {
  if (message.type === 'open') {
    sockets.get(message.id)?.close()
    const socket = new WebSocket(message.url)
    sockets.set(message.id, socket)
    socket.onopen = () => port.postMessage({ type: 'open', id: message.id })
    socket.onmessage = event => port.postMessage({ type: 'message', id: message.id, data: event.data })
    socket.onerror = () => port.postMessage({ type: 'error', id: message.id })
    socket.onclose = event => {
      sockets.delete(message.id)
      port.postMessage({ type: 'close', id: message.id, code: event.code, reason: event.reason })
    }
  } else if (message.type === 'send') sockets.get(message.id)?.send(message.data)
  else if (message.type === 'close') sockets.get(message.id)?.close()
})

port.onDisconnect.addListener(() => {
  for (const socket of sockets.values()) socket.close()
  sockets.clear()
})
