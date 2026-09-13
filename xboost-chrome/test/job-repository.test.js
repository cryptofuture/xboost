'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { indexedDB, IDBKeyRange } = require('fake-indexeddb')
const repositoryModule = require('../job-repository')

globalThis.IDBKeyRange = IDBKeyRange

const legacyJobsKey = 'xboost:ai-jobs'
const legacySnapshotsKey = 'xboost:ai-profile-snapshots'
const removeDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase('xboost-ai')
  request.onsuccess = resolve
  request.onerror = () => reject(request.error)
})
function storage (initial = {}) {
  const data = structuredClone(initial)
  let writes = 0
  return {
    data,
    writes: () => writes,
    browser: {
      storage: {
        local: {
          async get (keys) {
            const selected = Array.isArray(keys) ? keys : [keys]
            return Object.fromEntries(selected.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])]))
          },
          async set (values) { writes++; Object.assign(data, structuredClone(values)) },
          async remove (keys) { for (const key of keys) delete data[key] }
        }
      }
    }
  }
}
function job (index, fields = {}) {
  const profileId = fields.profileId || (index % 2 ? 'solana' : 'btcwid')
  return {
    id: profileId + ':' + index,
    profileId,
    profileRevision: profileId + '-revision',
    profileName: profileId === 'solana' ? 'Solana Index' : 'Bitcoin Monitor Widget',
    expectedHandle: profileId === 'solana' ? 'index_solana' : 'BitcoinWidget',
    post: { id: String(index), author: 'person' + index, text: 'Long source body '.repeat(30) + index, postedAt: '2026-09-13T00:00:00.000Z' },
    text: 'Long draft body '.repeat(20) + index,
    status: 'ready',
    createdAt: new Date(Date.UTC(2026, 8, 13, 0, 0, index % 60)).toISOString(),
    ...fields
  }
}

test.beforeEach(removeDatabase)
test.afterEach(removeDatabase)

test('migrates legacy jobs once, extracts contexts and keeps compact headers', async () => {
  const jobs = Array.from({ length: 1000 }, (_, index) => job(index, index === 0 ? { accountSnapshot: { product: 'Bitcoin Monitor Widget', handle: 'BitcoinWidget', context: 'Authoritative context' } } : {}))
  const saved = storage({ [legacyJobsKey]: jobs, [legacySnapshotsKey]: {} })
  const repository = new repositoryModule.JobRepository(saved.browser, indexedDB)
  const headers = await repository.init(value => String(value || '').toLowerCase(), null)
  assert.equal(headers.length, 1000)
  assert.equal(headers[0].text, undefined)
  assert.equal(headers[0].post.text, undefined)
  assert.equal(saved.data[legacyJobsKey], undefined)
  assert.equal((await repository.getSnapshot('btcwid-revision')).context, 'Authoritative context')
  const retry = await repository.get('btcwid:0')
  assert.match(retry.post.text, /Long source body/)
  retry.status = 'queued'
  await repository.put(retry)
  assert.equal((await repository.getSnapshot(retry.profileRevision)).context, 'Authoritative context')
  repository.db.close()
})

test('resumes an interrupted migration idempotently without duplicate jobs', async () => {
  const partialStorage = storage({ [legacyJobsKey]: [job(1), job(2)], [legacySnapshotsKey]: {} })
  const partial = new repositoryModule.JobRepository(partialStorage.browser, indexedDB)
  partial.db = await partial.open()
  const tx = partial.db.transaction(['jobs', 'meta'], 'readwrite')
  tx.objectStore('jobs').put({ ...job(1), _seq: 1, _visible: 1, _profileSort: 'solana index', _orderTime: 0 })
  tx.objectStore('meta').put({ key: 'migration-v1', complete: false, nextIndex: 1, migratedJobs: 1 })
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  partial.db.close()

  const resumed = new repositoryModule.JobRepository(partialStorage.browser, indexedDB)
  const headers = await resumed.init(value => String(value || ''), null)
  assert.equal(headers.length, 2)
  assert.deepEqual(new Set(headers.map(item => item.id)), new Set(['solana:1', 'btcwid:2']))
  resumed.db.close()
})

test('page reads are bounded, stable while new jobs arrive and deterministically ordered', async () => {
  const saved = storage({ [legacyJobsKey]: Array.from({ length: 100 }, (_, index) => job(index)), [legacySnapshotsKey]: {} })
  const repository = new repositoryModule.JobRepository(saved.browser, indexedDB)
  await repository.init(value => String(value || ''), null)
  const first = await repository.page({ page: 2, pageSize: 25, profileFilter: '*' })
  assert.equal(first.jobs.length, 25)
  assert.equal(first.queue.total, 100)
  const ids = first.jobs.map(item => item.id)
  const writes = saved.writes()

  await repository.put(job(1000, { createdAt: '2026-09-13T01:00:00.000Z' }))
  const stable = await repository.page({ page: 2, pageSize: 25, profileFilter: '*', viewId: first.queue.viewId })
  assert.deepEqual(stable.jobs.map(item => item.id), ids)
  assert.equal(stable.queue.total, 100)
  assert.equal(stable.queue.newCount, 1)
  assert.equal(saved.writes(), writes, 'IndexedDB updates must not rewrite browser.storage history')

  const inserted = await repository.get('btcwid:1000')
  inserted.status = 'dismissed'
  await repository.put(inserted)
  const afterDismiss = await repository.page({ page: 2, pageSize: 25, profileFilter: '*', viewId: first.queue.viewId })
  assert.equal(afterDismiss.queue.newCount, 0)

  const refreshed = await repository.page({ page: 1, pageSize: 25, profileFilter: '*', viewId: first.queue.viewId, refreshSnapshot: true })
  assert.equal(refreshed.queue.total, 100)
  assert.equal(refreshed.jobs.length, 25)
  await repository.page({ page: 2, pageSize: 25, viewId: refreshed.queue.viewId })
  await repository.page({ page: 3, pageSize: 25, viewId: refreshed.queue.viewId })
  await repository.page({ page: 4, pageSize: 25, viewId: refreshed.queue.viewId })
  assert.ok(repository.views.get(refreshed.queue.viewId).pages.size <= 3)
  repository.db.close()
})

test('equal timestamps use job ID as a stable tie-breaker and filters recover after removal', async () => {
  const same = '2026-09-13T00:00:00.000Z'
  const saved = storage({ [legacyJobsKey]: [job(3, { createdAt: same }), job(1, { createdAt: same }), job(2, { createdAt: same })], [legacySnapshotsKey]: {} })
  const repository = new repositoryModule.JobRepository(saved.browser, indexedDB)
  await repository.init(value => String(value || ''), null)
  const page = await repository.page({ pageSize: 25 })
  assert.deepEqual(page.jobs.map(item => item.id), ['btcwid:2', 'solana:1', 'solana:3'])
  for (const item of page.jobs.filter(item => item.profileId === 'solana')) {
    item.status = 'dismissed'
    await repository.put(item)
  }
  const recovered = await repository.page({ profileFilter: 'solana', pageSize: 25 })
  assert.equal(recovered.queue.profileFilter, '*')
  repository.db.close()
})

test('local edits survive paging and reject stale writes from another panel', async () => {
  const saved = storage({ [legacyJobsKey]: [job(1)], [legacySnapshotsKey]: {} })
  const repository = new repositoryModule.JobRepository(saved.browser, indexedDB)
  await repository.init(value => String(value || ''), null)
  const first = await repository.putEdit({ jobId: 'solana:1', text: 'Panel one edit', writer: 'panel-one', expectedUpdatedAt: null })
  assert.equal(first.value.text, 'Panel one edit')
  const conflict = await repository.putEdit({ jobId: 'solana:1', text: 'Panel two edit', writer: 'panel-two', expectedUpdatedAt: null })
  assert.equal(conflict.conflict, true)
  assert.equal(conflict.current.text, 'Panel one edit')
  assert.equal((await repository.getEdits(['solana:1']))[0].text, 'Panel one edit')
  repository.db.close()
})

test('removing the only item on the final page clamps to the nearest page', async () => {
  const saved = storage({ [legacyJobsKey]: Array.from({ length: 26 }, (_, index) => job(index, { profileId: 'btcwid' })), [legacySnapshotsKey]: {} })
  const repository = new repositoryModule.JobRepository(saved.browser, indexedDB)
  await repository.init(value => String(value || ''), null)
  const last = await repository.page({ page: 2, pageSize: 25 })
  assert.equal(last.jobs.length, 1)
  const removed = last.jobs[0]
  removed.status = 'dismissed'
  await repository.put(removed)
  const clamped = await repository.page({ page: 2, pageSize: 25, viewId: last.queue.viewId })
  assert.equal(clamped.queue.page, 1)
  assert.equal(clamped.queue.pages, 1)
  assert.equal(clamped.jobs.length, 25)
  repository.db.close()
})
