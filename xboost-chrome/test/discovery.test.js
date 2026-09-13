'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { webcrypto } = require('node:crypto')
const discovery = require('../discovery')
const pagination = require('../queue-pagination')
const jobRepository = require('../job-repository')
const core = require('../shared')
const replies = require('../reply-context')
globalThis.crypto ??= webcrypto

function state () {
  return { activeId: 'btcwid', enabled: true, profiles: Object.fromEntries(core.PROFILES.map(profile => [profile.id, core.coerceSettings({ profileId: profile.id, keywords: ['topic'], threshold: 50 })])), details: {} }
}
async function catalog (saved = state()) {
  return discovery.catalog(core, saved, replies.ACCOUNTS, async () => 'Authoritative product facts')
}
const feature = (id, overrides = {}) => ({ id: String(id), text: 'topic question number ' + id + '?', handle: 'user' + id, postedAt: new Date().toISOString(), views: null, replies: 0, isReply: false, isPromoted: false, ...overrides })

test('search rotation is fair and never modifies saved targeting', async () => {
  const profiles = await catalog()
  const original = JSON.stringify(profiles)
  const session = discovery.create(profiles, {}, [])
  const order = Array.from({ length: 10 }, () => discovery.chooseSearch(session, []).profile.id)
  assert.deepEqual(order.slice(0, 5), core.PROFILES.map(profile => profile.id))
  assert.deepEqual(order.slice(5), order.slice(0, 5))
  assert.equal(JSON.stringify(profiles), original)
  assert.equal(session.target, 100)
  assert.ok(session.profiles[0].queries.every(query => query.query.includes('-filter:replies') && !query.query.includes('-filter:nativereposts')))
  assert.deepEqual(session.profiles[0].queries.slice(0, 2).map(query => query.mode), ['live', 'top'])
  assert.throws(() => discovery.options({ target: 0 }), /positive/)
})

test('discovery merges adjacent terms in groups of three with a simple fallback', async () => {
  const saved = state()
  saved.profiles.btcwid.keywords = ['crypto dashboard', 'trading dashboard', 'portfolio tracker', 'Bitcoin price']
  const profile = discovery.create([(await catalog(saved))[0]], {}, []).profiles[0]
  assert.equal(profile.queries[0].query, '("crypto dashboard" OR "trading dashboard" OR "portfolio tracker") -filter:replies')
  assert.equal(profile.queries[0].fallback, '"crypto dashboard"')
  assert.equal(profile.queries[16].query, '"Bitcoin price" -filter:replies')
  assert.ok(profile.queries.every(query => (query.query.match(/ OR /g) || []).length <= 2))
})

test('quality screening, backpressure, unique ownership and ready-only top-up', async () => {
  const session = discovery.create(await catalog(), { target: 2, backlog: 1 }, [])
  const profile = session.profiles[0]
  const jobs = []
  const accept = (post, selected = profile) => discovery.accept(session, selected, post, jobs, core, new Set(['owned']))
  assert.equal(accept(feature(1, { handle: 'owned' })), 'owned account')
  assert.equal(accept(feature(2, { postedAt: null })), 'stale or unknown age')
  assert.equal(accept(feature(3, { isReply: true })), 'reply without verified parent context')
  assert.equal(accept(feature(4)), 'queued')
  assert.equal(accept(feature(5)), 'backpressure')
  assert.equal(profile.seen['5'], undefined)
  assert.equal(accept(feature(4), session.profiles[1]), 'duplicate/history')
  jobs[0].status = 'skipped'
  discovery.invalidate(jobs)
  assert.equal(accept(feature(5)), 'queued')
  Object.assign(jobs[1], { status: 'ready', text: 'Useful answer' })
  let count = discovery.counts(session, profile, jobs)
  assert.equal(count.ready, 1)
  assert.equal(count.skipped, 1)
  const next = discovery.create(await catalog(), {}, jobs)
  count = discovery.counts(next, next.profiles[0], jobs)
  assert.equal(count.existing, 1)
  assert.equal(count.generated, 0)
  jobs[1].profileRevision = 'old'
  discovery.invalidate(jobs)
  assert.equal(discovery.counts(next, next.profiles[0], jobs).ready, 0)
  assert.equal(discovery.counts(next, next.profiles[0], jobs).older, 1)
})

test('cached progress expires when a ready source leaves the freshness window', async () => {
  const now = Date.parse('2026-09-13T12:00:00.000Z')
  const session = discovery.create([(await catalog())[0]], { ageHours: 1 }, [], now)
  const profile = session.profiles[0]
  const jobs = [{ id: 'fresh', profileId: profile.id, profileRevision: profile.revision, status: 'ready', text: 'Draft', post: { id: '1', postedAt: new Date(now - 59 * 60000).toISOString() } }]
  assert.equal(discovery.counts(session, profile, jobs, now).ready, 1)
  assert.equal(discovery.counts(session, profile, jobs, now + 2 * 60000).ready, 0)
  assert.equal(discovery.counts(session, profile, jobs, now + 2 * 60000).older, 1)
})

test('all visited searches report a shortfall without automatic revisits or completion', async () => {
  const session = discovery.create(await catalog(), {}, [])
  for (const profile of session.profiles) profile.queries = profile.queries.slice(0, 1)
  for (let i = 0; i < 5; i++) discovery.chooseSearch(session, [])
  assert.throws(() => discovery.chooseSearch(session, []), /No next search/)
  const summary = discovery.summary(session, [])
  assert.equal(summary.status, 'running')
  assert.ok(summary.profiles.every(profile => profile.ready === 0 && profile.state === 'searches visited' && profile.nextRetryAt > Date.now()))
})

test('profile revision includes custom facts and founder portfolio but ignores appearance', async () => {
  const saved = state()
  const before = await catalog(saved)
  saved.profiles.btcwid.dimOpacity = 19
  assert.equal((await catalog(saved))[0].revision, before[0].revision)
  saved.details.outruna = { name: 'Outruna', handle: 'outruna_wallet', context: 'Updated authoritative transaction 2FA context' }
  const after = await catalog(saved)
  assert.notEqual(after.find(profile => profile.id === 'outruna').revision, before.find(profile => profile.id === 'outruna').revision)
  assert.notEqual(after.find(profile => profile.id === 'founder').revision, before.find(profile => profile.id === 'founder').revision)
  assert.equal(after[0].revision, before[0].revision)
})

test('created profiles participate in discovery and founder portfolio context', async () => {
  const saved = state()
  saved.profiles['new-product'] = core.coerceSettings({ profileId: 'new-product', keywords: ['new product topic'], threshold: 50 })
  saved.details['new-product'] = { name: 'New Product', handle: 'new_product', blurb: 'New purpose', context: 'Verified new product capability' }
  const profiles = await catalog(saved)
  const custom = profiles.find(profile => profile.id === 'new-product')
  assert.equal(custom.account.handle, 'new_product')
  assert.equal(custom.account.context, 'Verified new product capability')
  assert.match(custom.queries?.[0]?.query || discovery.queries(custom)[0].query, /new product topic/)
  assert.ok(profiles.find(profile => profile.id === 'founder').account.portfolio.some(product => product.handle === 'new_product'))
})

test('existing sessions upgrade to deeper searches while preserving seen posts and progress', async () => {
  const session = discovery.create(await catalog(), {}, [])
  session.queryVersion = 3
  session.profiles[0].queries = [{ label: 'Old', query: 'topic' }]
  session.profiles[0].cursor = 1
  session.profiles[0].visits = { 0: 123 }
  session.profiles[0].seen['42'] = true
  discovery.upgrade(session)
  assert.equal(session.queryVersion, 4)
  assert.ok(session.profiles[0].queries.length > 1)
  assert.ok(session.profiles[0].queries.every(query => query.query.includes('-filter:replies')))
  assert.equal(session.profiles[0].seen['42'], true)
})

test('discovery retains bounded recent IDs while keeping the cumulative inspected count', async () => {
  const session = discovery.create([(await catalog())[0]], { target: 10000, backlog: 10000, authorLimit: 10000 }, [])
  const profile = session.profiles[0]
  const jobs = []
  for (let index = 0; index < discovery.MAX_RECENT_SEEN + 600; index++) {
    discovery.accept(session, profile, feature(100000 + index, { text: 'unrelated conversation' }), jobs, core, new Set())
  }
  assert.equal(discovery.counts(session, profile, jobs).inspected, discovery.MAX_RECENT_SEEN + 600)
  assert.ok(Object.keys(profile.seen).length <= discovery.MAX_RECENT_SEEN)
  assert.ok(profile.seenTrimmed > 0)
})

async function harness (saved, draft) {
  const root = 'moz-extension://test/'
  const data = saved || { 'xboost:profiles': state(), 'xboost:ai': { url: 'ws://localhost:4500/', token: 'x'.repeat(32) } }
  let listener
  let connected
  let disconnected
  let storageChanged
  let tabActivated
  const tabs = []
  const sent = []
  let calls = 0
  const browser = {
    storage: { local: { async get () { return structuredClone(data) }, async set (values) { Object.assign(data, structuredClone(values)) } }, onChanged: { addListener (fn) { storageChanged = fn } } },
    runtime: { getURL: path => root + path, onMessage: { addListener (fn) { listener = fn } }, onConnect: { addListener (fn) { connected = fn } } },
    webRequest: { onBeforeSendHeaders: { addListener () {} } },
    tabs: {
      onRemoved: { addListener () {} },
      onActivated: { addListener (fn) { tabActivated = fn } },
      async create (options) { const tab = { id: tabs.length + 10, ...options }; tabs.push(tab); return tab },
      async update (id, options) { const tab = tabs.find(tab => tab.id === id); assert.ok(tab, 'must only navigate a created tab'); Object.assign(tab, options); return tab },
      async sendMessage (id, message) { sent.push({ id, message }) },
      async query () { return tabs.filter(tab => /^https:\/\//.test(tab.url || '')) }
    }
  }
  class Client {
    on () {}
    async call () { return { account: { type: 'chatgpt' } } }
    async draft (prompt, signal) { calls++; return draft ? draft(prompt, signal) : 'Answer about ' + JSON.parse(prompt.input).sourcePost.text }
  }
  const context = {
    browser,
    XboostCore: { ...core, async loadSettings () { const id = data['xboost:profiles'].activeId; return { ...data['xboost:profiles'].profiles[id], enabled: data['xboost:profiles'].enabled } } },
    xboostProfileCommand: async message => { data['xboost:profiles'].activeId = message.profileId },
    XboostDiscovery: discovery,
    XboostQueuePagination: pagination,
    XboostJobRepository: jobRepository,
    XboostReplies: replies,
    XboostCodex: Client,
    AbortController,
    setTimeout,
    URL,
    URLSearchParams,
    fetch: async () => ({ ok: true, text: async () => 'Authoritative product facts' })
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../ai-background'), 'utf8'), context)
  const panel = { url: root + 'ai.html' }
  connected({ name: 'xboost:ai-panel', sender: panel, onDisconnect: { addListener (fn) { disconnected = fn } } })
  const call = (action, fields = {}, sender = panel) => listener({ type: 'xboost:ai', action, ...fields }, sender)
  await call('config')
  return { data, tabs, sent, browser, call, activate: async tabId => { tabActivated({ tabId }); await tick() }, disconnect: () => disconnected(), change: () => storageChanged({ 'xboost:profiles': { newValue: data['xboost:profiles'] } }, 'local'), calls: () => calls }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
async function waitFor (predicate) {
  for (let i = 0; i < 3000; i++) { if (predicate()) return; await tick() }
  assert.fail('Condition not reached')
}

test('one user-driven session reaches 100 ready drafts for its selected profile', async () => {
  const env = await harness()
  const start = await env.call('session-start', { profileId: 'outruna', options: { target: 100, backlog: 100 } })
  assert.equal(start.ok, true, start.error)
  assert.equal(env.tabs.length, 0, 'start must not navigate')
  assert.equal(env.data['xboost:profiles'].activeId, 'outruna')
  assert.equal((await env.call('session-next')).ok, true)
  const tab = env.tabs[0]
  const sender = { tab, frameId: 0, url: tab.url }
  const binding = (await env.call('session-context', {}, sender)).data
  assert.equal(binding.profileId, 'outruna')
  const normalizedByX = new URL(tab.url)
  normalizedByX.hostname = 'www.x.com'
  normalizedByX.searchParams.delete('src')
  assert.equal((await env.call('session-context', {}, { ...sender, url: normalizedByX.href })).data.profileId, 'outruna')
  assert.equal((await env.call('session-context', {}, { ...sender, url: 'https://x.com/home' })).data.bound, false)
  assert.equal((await env.call('session-context', {}, { ...sender, tab: { id: 999 } })).data.bound, false)
  for (let batch = 0; batch < 2; batch++) {
    const features = Array.from({ length: 50 }, (_, n) => feature(batch * 50 + n + 1000))
    const response = await env.call('session-batch', { epoch: binding.epoch, features }, sender)
    assert.equal(response.ok, true, response.error)
    assert.equal(response.data.results.filter(result => result === 'queued').length, 50)
  }
  await waitFor(() => env.data[discovery.KEY].status === 'complete')
  const summary = (await env.call('session-status')).data
  assert.equal(summary.profiles.length, 1)
  assert.equal(summary.profiles[0].ready, 100)
  assert.equal(summary.profiles[0].generated, 100)
  assert.equal(env.calls(), 100)
  assert.equal(env.tabs.length, 1)
  const newSession = await env.call('session-start', { profileId: 'outruna', options: { target: 100 } })
  assert.equal(newSession.data.status, 'complete')
  assert.equal(newSession.data.profiles[0].existing, 100)
  assert.equal(newSession.data.profiles[0].generated, 0)
  assert.equal(env.calls(), 100)
})

test('highlighted posts from manually browsed X tabs count toward the selected session profile', async () => {
  const env = await harness()
  await env.call('session-start', { profileId: 'outruna', options: { target: 2, backlog: 1 } })
  const home = { id: 88, url: 'https://x.com/home' }
  env.tabs.push(home)
  const features = feature(700, { text: 'topic wallet security question?', handle: 'wallet_user' })
  const fields = { profileId: 'outruna', features, post: { id: features.id, text: features.text, author: features.handle, postedAt: features.postedAt } }
  const accepted = await env.call('candidate', fields, { tab: home, frameId: 0, url: home.url })
  assert.equal(accepted.data.result, 'queued')
  await waitFor(() => env.data['xboost:ai-jobs']?.[0]?.status === 'ready')
  const progress = (await env.call('session-status')).data.profiles[0]
  assert.equal(progress.inspected, 1)
  assert.equal(progress.generated, 1)
  assert.equal(env.data['xboost:ai-jobs'][0].sessionId, env.data[discovery.KEY].id)
  assert.equal(env.data['xboost:ai-jobs'][0].profileId, 'outruna')
  assert.ok(env.sent.some(item => item.id === home.id && item.message.type === 'xboost:collect-candidates'))
  const wrong = await env.call('candidate', { ...fields, profileId: 'btcwid', features: feature(701) }, { tab: home, frameId: 0, url: home.url })
  assert.equal(wrong.data.ignored, true)
  assert.equal((await env.call('session-status')).data.profiles[0].inspected, 1)
})

test('force restart interrupts unfinished work and resets discovery without deleting ready drafts', async () => {
  const env = await harness(null, async (prompt, signal) => {
    const post = JSON.parse(prompt.input).sourcePost
    if (post.text.includes('801')) return 'Useful completed draft'
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped'))))
  })
  await env.call('session-start', { profileId: 'btcwid', options: { target: 3, backlog: 3 } })
  await env.call('session-next')
  const sender = { tab: env.tabs[0], frameId: 0, url: env.tabs[0].url }
  const binding = (await env.call('session-context', {}, sender)).data
  await env.call('session-batch', { epoch: binding.epoch, features: [feature(801), feature(802)] }, sender)
  await waitFor(() => env.calls() === 2)
  const oldId = env.data[discovery.KEY].id
  const restarted = await env.call('session-restart', { profileId: 'btcwid', options: { target: 3, backlog: 3 } })
  assert.equal(restarted.ok, true, restarted.error)
  assert.notEqual(env.data[discovery.KEY].id, oldId)
  assert.equal(restarted.data.status, 'running')
  assert.equal(restarted.data.profiles[0].existing, 1)
  assert.equal(restarted.data.profiles[0].inspected, 0)
  assert.equal(env.data['xboost:ai-jobs'].find(job => job.post.id === '802').status, 'interrupted')
  assert.equal(env.tabs.length, 1, 'restart must not navigate or close a tab')
})

test('start over creates a fresh session when discovery is stopped or has not started', async () => {
  const env = await harness()
  const first = await env.call('session-restart', { profileId: 'btcwid', options: { target: 4, backlog: 2 } })
  assert.equal(first.ok, true, first.error)
  assert.equal(first.data.status, 'running')
  assert.equal(first.data.target, 4)
  const firstId = env.data[discovery.KEY].id

  assert.equal((await env.call('session-stop')).data.status, 'stopped')
  const second = await env.call('session-restart', { profileId: 'solana-index', options: { target: 5, backlog: 2 } })
  assert.equal(second.ok, true, second.error)
  assert.equal(second.data.status, 'running')
  assert.equal(second.data.target, 5)
  assert.equal(second.data.profiles[0].id, 'solana-index')
  assert.notEqual(env.data[discovery.KEY].id, firstId)
})

test('paged status returns only one queue page and follows a visible anchor', async () => {
  const saved = { 'xboost:profiles': state(), 'xboost:ai': { url: 'ws://localhost:4500/', token: 'x'.repeat(32) } }
  saved['xboost:ai-jobs'] = Array.from({ length: 75 }, (_, index) => ({
    id: 'btcwid:' + index,
    profileId: 'btcwid',
    profileName: 'Bitcoin Monitor Widget',
    expectedHandle: 'BitcoinWidget',
    post: { id: String(index), author: 'person' + index, text: 'Question ' + index },
    status: 'ready',
    text: 'Draft ' + index,
    createdAt: new Date(2026, 0, index + 1).toISOString()
  }))
  const env = await harness(saved)
  const third = (await env.call('status', { paged: true, page: 3, profileFilter: '*' })).data
  assert.equal(third.jobs.length, 25)
  assert.equal(third.queue.page, 3)
  const anchorId = third.jobs[0].id
  const anchored = (await env.call('status', { paged: true, page: 3, profileFilter: '*', anchorId })).data
  assert.equal(anchored.queue.page, 3)
  assert.ok(anchored.jobs.some(job => job.id === anchorId))
})

test('persisted queue preserves inactive failures and deduplicates profile context', async () => {
  const saved = { 'xboost:profiles': state(), 'xboost:ai': { url: 'ws://localhost:4500/', token: 'x'.repeat(32) } }
  const accountSnapshot = { product: 'Bitcoin Monitor Widget', handle: 'BitcoinWidget', context: 'A large authoritative context' }
  saved['xboost:ai-jobs'] = Array.from({ length: 300 }, (_, index) => ({
    id: 'btcwid:' + index,
    profileId: 'btcwid',
    profileRevision: 'revision-1',
    accountSnapshot,
    expectedHandle: 'BitcoinWidget',
    post: { id: String(index), author: 'person' + index, text: 'Question ' + index },
    status: 'failed',
    createdAt: new Date(2026, 0, index + 1).toISOString()
  }))
  const env = await harness(saved)
  assert.equal(env.data['xboost:ai-jobs'].filter(job => job.status === 'failed').length, 300)
  assert.equal(env.data['xboost:ai-jobs'].filter(job => job.status === 'dismissed').length, 0)
  assert.ok(env.data['xboost:ai-jobs'].every(job => !job.accountSnapshot && job.profileName === 'Bitcoin Monitor Widget'))
  assert.deepEqual(env.data['xboost:ai-profile-snapshots']['revision-1'], accountSnapshot)
  const duplicate = await env.call('manual-select', { profileId: 'btcwid', post: { id: '0', author: 'person0', text: 'Question 0' } }, { tab: { id: 50 }, frameId: 0, url: 'https://x.com/home' })
  assert.equal(duplicate.data.duplicate, true)
})

test('pause, panel closure, restart and profile edits do not silently resume or duplicate work', async () => {
  const env = await harness(null, async (prompt, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error('Paused'))
    else signal.addEventListener('abort', () => reject(new Error('Paused')))
  }))
  await env.call('session-start', { profileId: 'btcwid' })
  await env.call('session-next')
  const sender = { tab: env.tabs[0], frameId: 0, url: env.tabs[0].url }
  const binding = (await env.call('session-context', {}, sender)).data
  await env.call('session-batch', { epoch: binding.epoch, features: [feature(1)] }, sender)
  await waitFor(() => env.calls() === 1)
  env.disconnect()
  await waitFor(() => env.data['xboost:ai-jobs'][0].status === 'interrupted')
  assert.equal(env.data[discovery.KEY].status, 'paused')
  const oldCount = env.data['xboost:ai-jobs'].length
  await env.call('session-batch', { epoch: binding.epoch, features: [feature(2)] }, sender)
  assert.equal(env.data['xboost:ai-jobs'].length, oldCount)
  const restored = await harness(structuredClone(env.data))
  assert.equal((await restored.call('session-status')).data.status, 'paused')
  assert.equal(restored.calls(), 0)
  assert.equal(restored.tabs.length, 0)
  restored.data['xboost:profiles'].details.btcwid = { name: 'Edited', handle: 'edited_account', context: 'New verified context' }
  restored.change()
  const changed = (await restored.call('session-status')).data
  assert.equal(changed.profiles[0].state, 'profile changed')
  await restored.call('session-accept-profile', { profileId: 'btcwid' })
  await restored.call('session-resume')
  assert.equal(restored.calls(), 0, 'old revision interrupted draft must not restart')
  await restored.call('session-stop')
  assert.equal((await restored.call('session-next')).ok, false)
  assert.equal(restored.data['xboost:ai-jobs'][0].expectedHandle, 'BitcoinWidget')
})

test('Codex errors pause without retry and reported X limits require a manual cooldown', async () => {
  const env = await harness(null, async () => { throw new Error('Usage limit reached') })
  await env.call('session-start', { profileId: 'btcwid' })
  await env.call('session-next')
  const sender = { tab: env.tabs[0], frameId: 0, url: env.tabs[0].url }
  const binding = (await env.call('session-context', {}, sender)).data
  await env.call('session-batch', { epoch: binding.epoch, features: [feature(123)] }, sender)
  await waitFor(() => env.data[discovery.KEY].status === 'paused')
  assert.match(env.data[discovery.KEY].reason, /Usage limit reached/)
  await tick()
  assert.equal(env.calls(), 1)
  await env.call('session-x-blocked')
  const response = await env.call('session-resume')
  assert.equal(response.ok, false)
  assert.match(response.error, /cooldown/)
})

test('pause during a pending search open cancels navigation and rolls back search rotation', async () => {
  const env = await harness()
  await env.call('session-start', { profileId: 'btcwid' })
  let finishCreating
  env.browser.tabs.create = () => new Promise(resolve => { finishCreating = resolve })
  const opening = env.call('session-next')
  await waitFor(() => Boolean(finishCreating))
  const pausing = env.call('session-pause')
  finishCreating({ id: 100 })
  assert.equal((await opening).ok, false)
  assert.equal((await pausing).ok, true)
  assert.equal(env.data[discovery.KEY].status, 'paused')
  assert.equal(env.data[discovery.KEY].cursor, 0)
  assert.equal(env.data[discovery.KEY].profiles[0].cursor, 0)
  assert.equal(env.tabs.length, 0)
  assert.equal(env.calls(), 0)
})

test('deep searches reuse one owned tab, switch profile and provide a simple fallback', async () => {
  const env = await harness()
  await env.call('session-start', { profileId: 'outruna' })
  assert.equal((await env.call('session-next')).ok, true)
  assert.equal(env.tabs.length, 1)
  assert.equal(env.data['xboost:profiles'].activeId, 'outruna')
  assert.equal(new URL(env.tabs[0].url).hash, '')
  assert.equal(new URL(env.tabs[0].url).searchParams.get('f'), 'live')
  assert.equal(new URL(env.tabs[0].url).searchParams.get('q'), '"topic" -filter:replies')
  assert.equal((await env.call('session-next')).ok, true)
  assert.equal(env.tabs.length, 1, 'must reuse the extension-owned tab')
  assert.equal(new URL(env.tabs[0].url).searchParams.get('f'), 'top')
  assert.equal((await env.call('session-simple-search')).ok, true)
  assert.equal(new URL(env.tabs[0].url).searchParams.get('q'), '"topic"')
  assert.equal(new URL(env.tabs[0].url).searchParams.get('f'), 'live')
})
