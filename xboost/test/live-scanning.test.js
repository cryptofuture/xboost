'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')

test('profile updates rescore visible posts and scrolling scores new/recycled posts with new keywords', async () => {
  let changed
  let mutated
  let discoveryBinding = null
  let banner = null
  const batches = []
  const timers = []
  const scored = []
  let fullPostScans = 0
  let settings = { enabled: true, profileId: 'btcwid', keywords: ['old'], threshold: 55 }
  function article (id, text) {
    const post = {
      id,
      text,
      nodeType: 1,
      author: 'author',
      isConnected: true,
      button: null,
      style: { removeProperty () {} },
      removeAttribute () {},
      hasAttribute: () => false,
      matches: selector => selector === 'article[data-testid="tweet"]',
      closest: selector => selector === 'article[data-testid="tweet"]' ? post : null,
      append (button) { post.button = button; button.remove = () => { post.button = null } },
      querySelector (selector) { return selector.includes('data-xboost-select') ? post.button : null },
      querySelectorAll (selector) {
        if (selector === 'a[href*="/status/"]') return [{ closest: () => null, getAttribute: () => '/' + post.author + '/status/' + post.id }]
        if (selector === '[data-testid="tweetText"]') return [{ closest: () => null, textContent: post.text }]
        return []
      }
    }
    return post
  }
  const posts = [article('1', 'First post')]
  const root = { isConnected: true, append (node) { banner = node } }
  const core = {
    STORAGE_KEY: 'settings',
    PROFILE_KEY: 'profiles',
    DEFAULT_SETTINGS: settings,
    async loadSettings () { return settings },
    coerceSettings: value => value,
    ageMinutesFromISO: () => null,
    normaliseHandle: value => value,
    parseCompactNumber: () => null,
    parseMetricsLabel: () => ({}),
    scorePost (features, current) { scored.push({ id: features.id, keywords: current.keywords }); return { scorable: false } }
  }
  const context = {
    XboostCore: core,
    browser: { storage: { local: { async get () { return {} } }, onChanged: { addListener (fn) { changed = fn } } }, runtime: { async sendMessage (message) { if (message.action === 'session-batch') batches.push(message); return { ok: true, data: discoveryBinding || { bound: false } } }, onMessage: { addListener () {} } } },
    document: {
      body: root,
      querySelector: () => root,
      getElementById: () => banner,
      querySelectorAll: selector => { if (selector === 'article[data-testid="tweet"]') fullPostScans++; return posts },
      createElement: () => ({ style: {}, setAttribute () {}, remove () { banner = null } })
    },
    location: { href: 'https://x.com/search', pathname: '/search' },
    MutationObserver: class { constructor (fn) { mutated = fn } observe () {} disconnect () {} },
    window: { setTimeout (fn) { timers.push(fn); return timers.length }, setInterval () {}, addEventListener () {} },
    performance: { now: () => 0 },
    console
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../content'), 'utf8'), context)
  await new Promise(resolve => setImmediate(resolve))
  const flush = () => { while (timers.length) timers.shift()() }
  flush()
  assert.equal(scored[0].keywords[0], 'old')
  settings = { ...settings, keywords: ['new targeting'] }
  changed({ settings: { newValue: settings } }, 'local')
  flush()
  assert.equal(scored.at(-1).id, '1')
  assert.equal(scored.at(-1).keywords[0], 'new targeting')
  posts.push(article('2', 'Loaded after scrolling'))
  mutated()
  flush()
  assert.equal(scored.at(-1).id, '2')
  assert.equal(scored.at(-1).keywords[0], 'new targeting')
  const scansBeforeTargetedMutation = fullPostScans
  posts[1].text = 'Changed article text'
  mutated([{ target: posts[1], addedNodes: [] }])
  flush()
  assert.equal(fullPostScans, scansBeforeTargetedMutation, 'an article mutation must not query every rendered post')
  assert.equal(scored.at(-1).id, '2')
  posts[0].id = '3'
  posts[0].text = 'Recycled article after scrolling'
  mutated()
  flush()
  assert.equal(scored.at(-1).id, '3')
  assert.equal(scored.at(-1).keywords[0], 'new targeting')
  const own = article('10', 'Our own post')
  own.author = 'bItCoInWiDgEt'
  posts.push(own)
  mutated()
  flush()
  assert.equal(own.button, null)
  assert.ok(posts[0].button)
  changed({ profiles: { newValue: { details: { founder: { handle: 'author' } } } } }, 'local')
  flush()
  assert.equal(posts[0].button, null)
  discoveryBinding = { bound: true, active: true, name: 'Outruna', profileId: 'outruna', epoch: 7, settings: { ...settings, profileId: 'outruna', keywords: ['wallet'] } }
  changed({ 'xboost:discovery-session': { newValue: {} } }, 'local')
  await new Promise(resolve => setImmediate(resolve))
  flush()
  await new Promise(resolve => setImmediate(resolve))
  assert.match(banner.textContent, /Outruna/)
  assert.equal(scored.at(-1).keywords[0], 'wallet')
  assert.equal(batches.at(-1).epoch, 7)
  assert.ok(batches.at(-1).features.some(post => post.id === '10'))
  assert.equal(settings.profileId, 'btcwid', 'global profile must stay unchanged')
  const submitted = batches.length
  mutated()
  flush()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(batches.length, submitted, 'already submitted visible posts should not be resent on every mutation')
  const count = batches.length
  discoveryBinding = { ...discoveryBinding, active: false, epoch: 8 }
  changed({ 'xboost:discovery-session': { newValue: {} } }, 'local')
  await new Promise(resolve => setImmediate(resolve))
  flush()
  assert.equal(batches.length, count)
})
