'use strict'
const { performance } = require('node:perf_hooks')
const { indexedDB, IDBKeyRange } = require('fake-indexeddb')
const { JobRepository } = require('../job-repository')

globalThis.IDBKeyRange = IDBKeyRange

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (!sizes.length) sizes.push(1000, 10000, 50000)
const profiles = ['btcwid', 'solana', 'outruna', 'intent', 'founder']
const statuses = ['ready', 'queued', 'failed', 'skipped', 'replied', 'dismissed']
const elapsed = async operation => {
  const start = performance.now()
  const result = await operation()
  return { result, milliseconds: performance.now() - start }
}
const p95 = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
const removeDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase('xboost-ai')
  request.onsuccess = resolve
  request.onerror = () => reject(request.error)
})
function fixtures (count) {
  return Array.from({ length: count }, (_, index) => {
    const profileId = profiles[index % profiles.length]
    const status = statuses[index % statuses.length]
    return {
      id: profileId + ':' + index,
      profileId,
      profileRevision: profileId + '-r' + (index % 3),
      profileName: profileId,
      expectedHandle: profileId,
      sessionId: index % 4 ? undefined : 'older-session',
      post: { id: String(index), author: 'author' + (index % 2000), text: 'Source conversation with a long URL https://example.com/' + index + ' ' + 'context '.repeat(45), postedAt: new Date(Date.now() - (index % 1440) * 60000).toISOString() },
      text: status === 'ready' || status === 'replied' ? 'Generated draft ' + index + ' ' + 'answer '.repeat(30) : '',
      error: status === 'failed' ? 'Original retryable failure detail ' + index : '',
      repliedAt: status === 'replied' ? new Date().toISOString() : undefined,
      status,
      createdAt: new Date(Date.now() - index * 1000).toISOString(),
      accountSnapshot: index < 15 ? { product: profileId, handle: profileId, context: 'Repeated authoritative context for ' + profileId } : undefined
    }
  })
}
function storage (jobs) {
  const data = { 'xboost:ai-jobs': jobs, 'xboost:ai-profile-snapshots': {} }
  let writes = 0
  let bytes = 0
  return {
    stats: () => ({ writes, bytes }),
    local: {
      async get (keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) },
      async set (values) { writes++; bytes += JSON.stringify(values).length; Object.assign(data, values) },
      async remove (keys) { for (const key of keys) delete data[key] }
    }
  }
}
async function run (count) {
  await removeDatabase()
  const jobs = fixtures(count)
  const local = storage(jobs)
  const oldSerialize = await elapsed(() => Promise.resolve(JSON.stringify(JSON.parse(JSON.stringify(jobs))).length))
  const oldPageSamples = []
  for (let page = 1; page <= 20; page++) {
    const sample = await elapsed(() => Promise.resolve(jobs.slice().sort((left, right) => String(left.profileName).localeCompare(String(right.profileName)) || Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice((page - 1) * 25, page * 25)))
    oldPageSamples.push(sample.milliseconds)
  }
  const repository = new JobRepository({ storage: { local: local.local } }, indexedDB)
  const migration = await elapsed(() => repository.init(value => String(value || '').toLowerCase(), null))
  const view = await repository.page({ page: 1, pageSize: 25 })
  const pageSamples = []
  const pages = Math.max(1, view.queue.pages)
  for (let index = 0; index < 20; index++) {
    const page = 1 + ((index * 97) % pages)
    const sample = await elapsed(() => repository.page({ page, pageSize: 25, viewId: view.queue.viewId }))
    pageSamples.push(sample.milliseconds)
  }
  const selected = await repository.get(jobs[Math.floor(count / 2)].id)
  selected.status = selected.status === 'dismissed' ? 'ready' : 'dismissed'
  const update = await elapsed(() => repository.put(selected))
  const heap = process.memoryUsage().heapUsed
  repository.db.close()
  return {
    jobs: count,
    fixtureBytes: JSON.stringify(jobs).length,
    oldFullSerializeMs: Number(oldSerialize.milliseconds.toFixed(2)),
    oldFullSerializeBytes: oldSerialize.result,
    migrationMs: Number(migration.milliseconds.toFixed(2)),
    compactHeaders: migration.result.length,
    pageP95Ms: Number(p95(pageSamples).toFixed(2)),
    oldPageSortP95Ms: Number(p95(oldPageSamples).toFixed(2)),
    oneJobUpdateMs: Number(update.milliseconds.toFixed(2)),
    browserStorageWritesAfterMigrationAndUpdate: local.stats(),
    heapUsedMiB: Number((heap / 1024 / 1024).toFixed(1))
  }
}

;(async () => {
  const results = []
  for (const size of sizes) results.push(await run(size))
  console.log(JSON.stringify({ runtime: process.version, platform: `${process.platform}/${process.arch}`, method: 'Node fake-indexeddb; not a browser heap profile', results }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
