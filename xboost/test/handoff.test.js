'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const jobRepository = require('../job-repository')

test('edited reply handoff is bound to the created tab and exact source post', async () => {
  let listener
  let removed
  let opened
  const root = 'moz-extension://test/'
  const job = { id: 'btcwid:123', status: 'ready', expectedHandle: 'BitcoinWidget', post: { id: '123', author: 'someone' }, text: 'Original' }
  const browser = {
    storage: { local: { async get () { return { 'xboost:ai-jobs': [job] } }, async set () {} } },
    runtime: {
      getURL: path => root + path,
      onMessage: { addListener (fn) { listener = fn } },
      onConnect: { addListener () {} }
    },
    webRequest: { onBeforeSendHeaders: { addListener () {} } },
    tabs: {
      onRemoved: { addListener (fn) { removed = fn } },
      async create () { return { id: 9 } },
      async update (id, properties) { opened = { id, ...properties } }
    }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../ai-background'), 'utf8'), { browser, URL, XboostJobRepository: jobRepository, setTimeout })
  const call = (action, sender, fields = {}) => listener({ type: 'xboost:ai', action, ...fields }, sender)
  const panel = { url: root + 'ai.html' }
  assert.equal((await call('prepare', panel, { id: job.id, text: 'Edited reply' })).ok, true)
  assert.deepEqual(opened, { id: 9, url: 'https://x.com/someone/status/123' })
  const sender = { tab: { id: 9 }, frameId: 0, url: opened.url }
  assert.equal((await call('handoff', sender)).data.text, 'Edited reply')
  assert.equal((await call('handoff', { ...sender, tab: { id: 10 } })).data, null)
  assert.equal((await call('handoff', { ...sender, url: 'https://x.com/someone/status/456' })).data, null)
  assert.equal((await call('handoff', { ...sender, frameId: 1 })).ok, false)
  assert.equal((await call('prepare', sender, { id: job.id, text: 'Wrong sender' })).ok, false)
  removed(9)
  assert.equal((await call('handoff', sender)).data, null)
  let refreshed
  browser.tabs.query = async () => [
    { id: 20, url: 'https://x.com/search?q=crypto', title: 'Search' },
    { id: 21, url: 'https://x.com/someone/status/123', title: 'Reply source' }
  ]
  browser.tabs.reload = async id => { refreshed = id }
  browser.tabs.sendMessage = async () => ({ ok: false, error: 'Composer contains text' })
  assert.equal((await call('discovery-tabs', panel)).data.length, 1)
  assert.equal((await call('discover', panel, { mode: 'refresh', tabId: 21 })).ok, false)
  assert.equal((await call('discover', panel, { mode: 'refresh', tabId: 20 })).ok, false)
  assert.equal(refreshed, undefined)
  browser.tabs.sendMessage = async () => ({ ok: true })
  assert.equal((await call('discover', panel, { mode: 'refresh', tabId: 20 })).ok, true)
  assert.equal(refreshed, 20)
  assert.equal((await call('discover', panel, { mode: 'more', tabId: 20 })).ok, true)
  assert.equal(opened.id, 20)
  assert.equal((await call('mark-replied', sender, { id: job.id })).ok, false)
  assert.equal((await call('mark-replied', panel, { id: job.id, text: 'Actually sent' })).ok, true)
  let stored = (await call('queue-page', panel)).data.jobs[0]
  assert.equal(stored.status, 'replied')
  assert.equal(stored.sentText, 'Actually sent')
  assert.ok(stored.repliedAt)
  assert.equal((await call('prepare', panel, { id: job.id, text: 'Duplicate' })).ok, false)
  await call('dismiss', panel, { id: job.id })
  assert.equal((await call('queue-page', panel)).data.jobs[0].status, 'replied')
  assert.equal((await call('mark-replied', panel, { id: job.id, undo: true })).ok, true)
  stored = (await call('queue-page', panel)).data.jobs[0]
  assert.equal(stored.status, 'ready')
  assert.equal(stored.repliedAt, undefined)
})
