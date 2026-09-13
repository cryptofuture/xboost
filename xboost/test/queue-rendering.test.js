'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const pagination = require('../queue-pagination')

test('incoming drafts preserve edited text and the visible card scroll anchor', () => {
  const elements = new Map()
  const viewport = { scrollY: 250, innerHeight: 700, addEventListener () {}, setInterval () {}, scrollBy (x, y) { this.scrollY += y } }
  function node (tag = 'div') {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      listeners: {},
      append (...nodes) { this.children.push(...nodes) },
      replaceChildren (...nodes) { this.children = nodes },
      setAttribute () {},
      addEventListener (type, fn) { this.listeners[type] = fn },
      getBoundingClientRect () { const top = elements.get('drafts').children.indexOf(this) * 400 - viewport.scrollY; return { top, bottom: top + 400, height: 400 } }
    }
  }
  const document = {
    activeElement: null,
    getElementById (id) {
      if (id.startsWith('job-')) return elements.get('drafts').children.find(card => card.id === id)
      if (!elements.has(id)) elements.set(id, node())
      return elements.get(id)
    },
    createElement: node
  }
  const browser = { runtime: { connect: () => ({ onDisconnect: { addListener () {} } }), sendMessage: () => new Promise(() => {}) }, storage: { onChanged: { addListener () {} } } }
  const context = { browser, document, window: viewport, XboostQueuePagination: pagination }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(require.resolve('../ai'), 'utf8'), context)
  const old = { id: 'btcwid:1', profileId: 'btcwid', expectedHandle: 'BitcoinWidget', post: { id: '1', author: 'person', text: 'Question' }, status: 'ready', text: 'Generated draft' }
  context.renderJobs([old])
  const first = elements.get('drafts').children.find(child => child.id === 'job-btcwid:1')
  const textarea = first.children.find(child => child.tagName === 'TEXTAREA')
  textarea.value = 'My unsaved edit'
  textarea.listeners.input()
  context.renderJobs([old, { ...old, id: 'btcwid:2', post: { ...old.post, id: '2' } }])
  assert.equal(viewport.scrollY, 650)
  const restored = document.getElementById('job-btcwid:1')
  assert.equal(restored.getBoundingClientRect().top, 150)
  assert.equal(restored.children.find(child => child.tagName === 'TEXTAREA').value, 'My unsaved edit')
})

test('rapid page clicks keep only the newest requested destination', async () => {
  const elements = new Map()
  const pending = []
  function node (tag = 'div') {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      listeners: {},
      dataset: {},
      append (...nodes) { this.children.push(...nodes) },
      replaceChildren (...nodes) { this.children = nodes },
      setAttribute () {},
      addEventListener (type, fn) { this.listeners[type] = fn },
      querySelector () { return null },
      querySelectorAll () { return [] },
      scrollIntoView () {},
      getBoundingClientRect () { return { top: 0, bottom: 50, height: 50 } }
    }
  }
  const document = {
    activeElement: null,
    getElementById (id) {
      if (!elements.has(id)) elements.set(id, node())
      return elements.get(id)
    },
    createElement: node
  }
  const browser = {
    runtime: {
      connect: () => ({ onDisconnect: { addListener () {} }, onMessage: { addListener () {} } }),
      sendMessage (message) {
        if (message.action === 'config') return new Promise(() => {})
        if (message.action === 'discovery-tabs') return Promise.resolve({ ok: true, data: [] })
        return new Promise(resolve => pending.push({ message, resolve }))
      }
    },
    storage: { onChanged: { addListener () {} } }
  }
  const viewport = { scrollY: 0, innerHeight: 700, addEventListener () {}, setInterval () {}, scrollBy () {}, scrollTo () {} }
  const context = { browser, document, window: viewport, XboostQueuePagination: pagination }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(require.resolve('../ai'), 'utf8'), context)
  const first = context.refreshQueue(false, 3)
  context.refreshQueue(false, 4)
  context.refreshQueue(false, 5)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].message.page, 3)
  pending.shift().resolve({ ok: true, data: { jobs: [], queue: { paged: true, page: 3, pages: 5, total: 125, profileFilter: '*', profiles: [], viewId: 'view', newCount: 0 } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 1)
  assert.equal(pending[0].message.page, 5)
  pending.shift().resolve({ ok: true, data: { jobs: [], queue: { paged: true, page: 5, pages: 5, total: 125, profileFilter: '*', profiles: [], viewId: 'view', newCount: 0 } } })
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.match(elements.get('page-status').textContent, /Page 5 of 5/)
})
