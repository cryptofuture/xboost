'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { XboostCodex, xboostAuthHeaders } = require('../codex-client')

function fixture (respond = () => ({})) {
  const sent = []
  let socket
  const client = new XboostCodex('ws://localhost:4500/', () => {
    socket = {
      readyState: 1,
      close () {},
      send (data) {
        const message = JSON.parse(data)
        sent.push(message)
        if (message.id && message.method) {
          const result = respond(message, notify)
          if (result !== undefined) queueMicrotask(() => notify({ id: message.id, result }))
        }
      }
    }
    queueMicrotask(() => socket.onopen())
    return socket
  })
  const notify = message => socket.onmessage({ data: JSON.stringify(message) })
  return { client, sent, notify }
}

test('capability token only reaches exact extension-origin WebSocket endpoint', () => {
  const root = 'moz-extension://test/'
  const target = { url: 'ws://localhost:4500/', token: 'test-token' }
  const details = { type: 'websocket', url: target.url, originUrl: root + '_generated_background_page.html', requestHeaders: [{ name: 'Origin', value: root }, { name: 'Upgrade', value: 'websocket' }] }
  assert.deepEqual(xboostAuthHeaders(details, target, root).requestHeaders, [
    { name: 'Upgrade', value: 'websocket' }, { name: 'Authorization', value: 'Bearer test-token' }
  ])
  for (const change of [{ originUrl: 'https://x.com/' }, { originUrl: undefined }, { url: 'ws://localhost:4501/' }, { url: target.url + 'other' }, { type: 'xmlhttprequest' }]) {
    assert.equal(xboostAuthHeaders({ ...details, ...change }, target, root), undefined)
  }
})

test('initializes once, handles RPC and denies server tool requests', async () => {
  const { client, sent, notify } = fixture()
  await Promise.all([client.start(), client.start()])
  assert.deepEqual(sent.map(message => message.method), ['initialize', 'initialized'])
  await client.call('account/read')
  notify({ id: 'tool1', method: 'item/tool/call', params: {} })
  assert.equal(sent.at(-1).error.code, -32601)
  client.close()
})

test('draft captures notifications arriving before turn/start response', async () => {
  const { client, sent } = fixture((message, notify) => {
    if (message.method === 'thread/start') return { thread: { id: 'thread1' } }
    if (message.method === 'turn/start') {
      notify({ method: 'turn/started', params: { threadId: 'thread1', turn: { id: 'turn1' } } })
      notify({ method: 'item/completed', params: { threadId: 'thread1', item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: 'Thinking' } } })
      notify({ method: 'item/completed', params: { threadId: 'thread1', item: { id: 'answer', type: 'agentMessage', text: 'Useful reply' } } })
      notify({ method: 'turn/completed', params: { threadId: 'thread1', turn: { id: 'turn1', status: 'completed' } } })
      return { turn: { id: 'turn1' } }
    }
    return {}
  })
  assert.equal(await client.draft({ instructions: 'Facts', input: 'Post' }, new AbortController().signal), 'Useful reply')
  const params = sent.find(message => message.method === 'thread/start').params
  assert.equal(params.sandbox, 'read-only')
  assert.equal(params.model, 'gpt-5.6-luna')
  const turn = sent.find(message => message.method === 'turn/start').params
  assert.equal(turn.model, 'gpt-5.6-luna')
  assert.equal(turn.effort, 'low')
  assert.equal(params.approvalPolicy, 'never')
  assert.equal(params.config['features.shell_tool'], false)
  client.close()
})

test('abort interrupts active turn and rejects draft', async () => {
  const controller = new AbortController()
  const { client, sent } = fixture(message => {
    if (message.method === 'thread/start') return { thread: { id: 'thread1' } }
    if (message.method === 'turn/start') {
      setImmediate(() => controller.abort())
      return { turn: { id: 'turn1' } }
    }
    return {}
  })
  await assert.rejects(client.draft({ instructions: 'Facts', input: 'Post' }, controller.signal), /Stopped/)
  assert.ok(sent.some(message => message.method === 'turn/interrupt'))
  client.close()
})

test('disconnect rejects pending requests and allows a fresh handshake', async () => {
  const { client, sent } = fixture(message => message.method === 'account/read' ? undefined : {})
  await client.start()
  const pending = client.call('account/read')
  await new Promise(resolve => setImmediate(resolve))
  client.close()
  await assert.rejects(pending, /closed/)
  await client.start()
  assert.equal(sent.filter(message => message.method === 'initialize').length, 2)
  client.close()
})
