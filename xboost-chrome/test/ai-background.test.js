'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { webcrypto } = require('node:crypto')
const replies = require('../reply-context')
const core = require('../shared')
const discovery = require('../discovery')
const pagination = require('../queue-pagination')
const jobRepository = require('../job-repository')

test('direct background queues, deduplicates, isolates accounts and pauses when panel closes', async () => {
  const root = 'moz-extension://test/'
  const profileState = { activeId: 'btcwid', enabled: true, profiles: Object.fromEntries(core.PROFILES.map(profile => [profile.id, core.settingsFromProfile(profile, core.DEFAULT_SETTINGS)])), details: {} }
  const data = { 'xboost:ai': { url: 'ws://localhost:4500/', token: 'x'.repeat(32), enabled: true }, 'xboost:profiles': profileState }
  let listener
  let connect
  let disconnect
  let draftSignal
  const browser = {
    storage: {
      local: {
        async get () { return structuredClone(data) },
        async set (values) { Object.assign(data, structuredClone(values)) }
      }
    },
    webRequest: { onBeforeSendHeaders: { addListener () {} } },
    runtime: {
      getURL: path => root + path,
      onMessage: { addListener (value) { listener = value } },
      onConnect: { addListener (value) { connect = value } }
    },
    tabs: { async query () { return [] }, onRemoved: { addListener () {} } }
  }
  class Client {
    on () {}
    async call (method) { return method === 'account/read' ? { account: { type: 'chatgpt' } } : {} }
    async draft (prompt, signal) {
      draftSignal = signal
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped'))))
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../ai-background'), 'utf8'), {
    browser,
    XboostCodex: Client,
    XboostReplies: replies,
    XboostCore: { ...core, async loadSettings () { return { ...profileState.profiles[profileState.activeId], enabled: true } } },
    XboostDiscovery: discovery,
    XboostQueuePagination: pagination,
    XboostJobRepository: jobRepository,
    AbortController,
    setTimeout,
    URL,
    URLSearchParams,
    crypto: webcrypto,
    TextEncoder,
    fetch: async () => ({ ok: true, text: async () => 'Authoritative context' })
  })
  const panel = { url: root + 'ai.html', tab: { id: 2 } }
  const call = (action, fields = {}, sender = panel) => listener({ type: 'xboost:ai', action, ...fields }, sender)
  assert.equal((await call('status')).data.enabled, false)
  assert.equal((await call('config', {}, { url: 'https://x.com/', tab: { id: 1 } })).ok, false)
  connect({ name: 'xboost:ai-panel', sender: panel, onDisconnect: { addListener (value) { disconnect = value } } })
  assert.equal((await call('control', { enabled: true })).data.enabled, true)
  const sender = { url: 'https://x.com/search', tab: { id: 1 } }
  const fields = { profileId: 'btcwid', post: { id: '123', author: 'someone', text: 'Crypto dashboard recommendations?' } }
  assert.equal((await call('candidate', fields, sender)).data.queued, true)
  assert.equal((await call('candidate', fields, sender)).data.duplicate, true)
  assert.equal((await call('candidate', { ...fields, post: { ...fields.post, id: '124', author: 'index_solana' } }, sender)).data.ignored, true)
  await new Promise(resolve => setImmediate(resolve))
  disconnect()
  assert.equal(draftSignal.aborted, true)
  await new Promise(resolve => setImmediate(resolve))
  const status = (await call('status')).data
  assert.equal(status.enabled, false)
  assert.equal(status.jobs.length, 1)
  assert.equal(status.jobs[0].status, 'interrupted')
  assert.equal(status.jobs[0].expectedHandle, 'BitcoinWidget')
  assert.equal(data['xboost:ai-jobs'][0].status, 'interrupted')
  const settings = { url: root + 'options.html', tab: { id: 3 } }
  assert.equal((await call('config', {}, settings)).ok, true)
  assert.equal((await call('control', { enabled: true }, settings)).ok, false)
  assert.equal((await call('save', {}, panel)).ok, false)
  assert.equal((await call('retry', { id: status.jobs[0].id })).data.queued, true)
  assert.equal(data['xboost:ai-jobs'][0].status, 'queued')
  assert.equal((await call('retry', { id: status.jobs[0].id })).ok, false)
  const manual = { profileId: 'solana-index', post: { id: '999', author: 'builder', text: 'Historical Solana balances #Solana' } }
  assert.equal((await call('manual-select', manual, sender)).data.queued, true)
  assert.equal((await call('manual-select', manual, sender)).data.duplicate, true)
  const selected = data['xboost:ai-jobs'].find(job => job.post.id === '999')
  assert.equal(selected.status, 'queued')
  assert.equal(selected.source, 'manual')
  assert.equal(selected.expectedHandle, 'index_solana')
  assert.equal((await call('manual-select', { ...manual, post: { ...manual.post, id: '998', author: 'quellemor' } }, sender)).data.ignored, true)
  assert.equal((await call('queue-product', { id: selected.id, profileId: 'outruna' }, sender)).ok, false)
  assert.equal((await call('queue-product', { id: selected.id, profileId: 'outruna' })).ok, false)
  assert.equal((await call('assess', { id: selected.id })).ok, false)
})
