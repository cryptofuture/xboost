/* global WebSocket */
'use strict'

// Token injection is restricted to this extension's exact WebSocket endpoint.
function xboostAuthHeaders (details, target, extensionRoot) {
  if (!target || details.type !== 'websocket' || details.url !== target.url ||
      !(details.originUrl || details.documentUrl || '').startsWith(extensionRoot)) return undefined
  const requestHeaders = (details.requestHeaders || []).filter(header => !['authorization', 'origin'].includes(header.name.toLowerCase()))
  requestHeaders.push({ name: 'Authorization', value: `Bearer ${target.token}` })
  return { requestHeaders }
}

class XboostCodex {
  constructor (url, socketFactory = address => new WebSocket(address)) {
    this.url = url
    this.socketFactory = socketFactory
    this.pending = new Map()
    this.listeners = new Map()
    this.id = 0
  }

  on (name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
  }

  off (name, listener) { this.listeners.get(name)?.delete(listener) }
  emit (name, value) { for (const listener of this.listeners.get(name) || []) listener(value) }

  start () {
    if (this.ready) return this.ready
    this.ready = (async () => {
      await new Promise((resolve, reject) => {
        const socket = this.socketFactory(this.url)
        this.socket = socket
        const timer = setTimeout(() => this.fail(new Error('WebSocket connection timed out')), 15000)
        const failed = error => { clearTimeout(timer); this.off('disconnected', failed); reject(error) }
        this.on('disconnected', failed)
        socket.onopen = () => { clearTimeout(timer); this.off('disconnected', failed); resolve() }
        socket.onerror = () => this.fail(new Error('Cannot connect to Codex: check address, token and Firefox host permission'))
        socket.onclose = () => this.fail(new Error('Codex WebSocket disconnected'))
        socket.onmessage = event => {
          try { this.receive(JSON.parse(event.data)) } catch { this.fail(new Error('Invalid Codex response')) }
        }
      })
      await this.request('initialize', { clientInfo: { name: 'xboost', title: 'Xboost drafting', version: '1.21.1' } })
      this.send({ method: 'initialized', params: {} })
    })()
    return this.ready
  }

  send (message) {
    if (this.socket?.readyState !== 1) throw new Error('Codex is not connected')
    this.socket.send(JSON.stringify(message))
  }

  request (method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex ${method} timed out`))
      }, 60000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  receive (message) {
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: 'Xboost supports text drafting only' } })
      return
    }
    const pending = this.pending.get(message.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    } else if (message.method) this.emit('notification', message)
  }

  fail (error) {
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.onerror = null
      socket.onopen = null
      socket.onmessage = null
      socket.close()
    }
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    this.pending.clear()
    this.ready = null
    this.emit('disconnected', error)
  }

  async call (method, params) {
    await this.start()
    return this.request(method, params)
  }

  async draft (prompt, signal) {
    await this.start()
    if (signal.aborted) throw new Error('Stopped')
    const { thread } = await this.request('thread/start', {
      model: 'gpt-5.6-luna',
      ephemeral: true,
      config: { 'features.shell_tool': false, 'features.unified_exec': false, 'features.apps': false, web_search: 'disabled' },
      sandbox: 'read-only',
      approvalPolicy: 'never',
      baseInstructions: 'You write short factual social replies. Output text only. Never use tools or read files.',
      developerInstructions: prompt.instructions
    })
    let turnId
    let cleanup
    let cancel
    const completion = new Promise((resolve, reject) => {
      const answers = new Map()
      const timer = setTimeout(() => cancel(new Error('Draft timed out; automation paused')), 240000)
      const listener = ({ method, params }) => {
        if (params?.threadId !== thread.id) return
        if (method === 'turn/started') {
          turnId = params.turn.id
          if (signal.aborted) cancel(new Error('Stopped'))
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') answers.set(params.item.id, params.item.text)
        if (method === 'turn/completed') {
          cleanup()
          if (params.turn.status !== 'completed') reject(new Error(params.turn.error?.message || `Draft ${params.turn.status}`))
          else {
            const text = [...answers.values()].join('\n').trim()
            if (!text) reject(new Error('Codex returned no final draft'))
            else resolve(text)
          }
        }
      }
      const disconnected = error => { cleanup(); reject(error) }
      const abort = () => cancel(new Error('Stopped'))
      cleanup = () => {
        clearTimeout(timer)
        this.off('notification', listener)
        this.off('disconnected', disconnected)
        signal.removeEventListener('abort', abort)
      }
      cancel = error => {
        if (turnId) this.request('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {})
        cleanup()
        reject(error)
      }
      this.on('notification', listener)
      this.on('disconnected', disconnected)
      signal.addEventListener('abort', abort, { once: true })
    })
    // Attach rejection handling before turn/start; notifications can arrive first.
    completion.catch(() => {})
    try {
      if (signal.aborted) { cancel(new Error('Stopped')); return await completion }
      const result = await this.request('turn/start', { threadId: thread.id, model: 'gpt-5.6-luna', effort: 'low', input: [{ type: 'text', text: prompt.input }] })
      turnId = result.turn.id
      if (signal.aborted) cancel(new Error('Stopped'))
      return await completion
    } catch (error) {
      cancel(error)
      throw error
    } finally {
      cleanup()
      this.request('thread/unsubscribe', { threadId: thread.id }).catch(() => {})
    }
  }

  close () { this.fail(new Error('Codex connection closed')) }
}

globalThis.XboostCodex = XboostCodex
globalThis.xboostAuthHeaders = xboostAuthHeaders
if (typeof module !== 'undefined') module.exports = { XboostCodex, xboostAuthHeaders }
