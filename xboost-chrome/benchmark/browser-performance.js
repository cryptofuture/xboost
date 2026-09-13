/* global location */
'use strict'

;(async () => {
  const count = Math.max(1, Number(new URL(location.href).searchParams.get('count')) || 10000)
  const profiles = ['btcwid', 'solana', 'outruna', 'intent', 'founder']
  const statuses = ['ready', 'queued', 'failed', 'skipped', 'replied', 'dismissed']
  let jobs = Array.from({ length: count }, (_, index) => {
    const profileId = profiles[index % profiles.length]
    const status = statuses[index % statuses.length]
    return {
      id: profileId + ':' + index,
      profileId,
      profileRevision: profileId + '-r' + (index % 3),
      profileName: profileId,
      expectedHandle: profileId,
      post: { id: String(index), author: 'author' + (index % 2000), text: 'Source ' + index + ' ' + 'context '.repeat(45), postedAt: new Date(Date.now() - (index % 1440) * 60000).toISOString() },
      text: status === 'ready' || status === 'replied' ? 'Draft ' + index + ' ' + 'answer '.repeat(30) : '',
      error: status === 'failed' ? 'Original failure ' + index : '',
      repliedAt: status === 'replied' ? new Date().toISOString() : undefined,
      status,
      createdAt: new Date(Date.now() - index * 1000).toISOString(),
      accountSnapshot: index < 15 ? { product: profileId, handle: profileId, context: 'Repeated authoritative context for ' + profileId } : undefined
    }
  })
  const data = { 'xboost:ai-jobs': jobs, 'xboost:ai-profile-snapshots': {} }
  let storageWrites = 0
  let storageBytes = 0
  const browser = {
    storage: {
      local: {
        async get (keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])) },
        async set (values) { storageWrites++; storageBytes += JSON.stringify(values).length; Object.assign(data, values) },
        async remove (keys) { for (const key of keys) delete data[key] }
      }
    }
  }
  const measure = async operation => {
    const started = performance.now()
    const value = await operation()
    return { value, milliseconds: performance.now() - started }
  }
  const percentile = values => values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
  const oldSerialize = await measure(() => Promise.resolve(JSON.stringify(JSON.parse(JSON.stringify(jobs))).length))
  const oldPages = []
  for (let index = 0; index < 20; index++) {
    const sample = await measure(() => Promise.resolve(jobs.slice().sort((left, right) => String(left.profileName).localeCompare(String(right.profileName)) || Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(index * 25, index * 25 + 25)))
    oldPages.push(sample.milliseconds)
  }
  const repository = new globalThis.XboostJobRepository.JobRepository(browser)
  const migration = await measure(() => repository.init(value => String(value || '').toLowerCase(), null))
  const headerCount = migration.value.length
  const discoveryProfile = { id: 'btcwid', revision: 'btcwid-r0', settings: { maxAgeMinutes: 0 }, seen: {}, reasons: {}, inspected: 0 }
  const discoverySession = { id: 'benchmark-session', target: count + 1, backlog: count + 1, authorLimit: count + 1, ageHours: 24, baseline: [], allocated: {}, status: 'running' }
  globalThis.XboostDiscovery.counts(discoverySession, discoveryProfile, migration.value)
  const screening = await measure(() => {
    for (let index = 0; index < 1000; index++) {
      globalThis.XboostDiscovery.accept(discoverySession, discoveryProfile, { id: String(count + index), text: 'candidate', handle: 'owned', postedAt: new Date().toISOString(), isReply: false }, migration.value, {}, new Set(['owned']))
    }
    return Promise.resolve()
  })
  migration.value = null
  const first = await repository.page({ page: 1 })
  const pageTimes = []
  for (let index = 0; index < 20; index++) {
    const page = 1 + ((index * 97) % first.queue.pages)
    const sample = await measure(() => repository.page({ page, viewId: first.queue.viewId }))
    pageTimes.push(sample.milliseconds)
  }
  const selected = await repository.get(profiles[Math.floor(count / 2) % profiles.length] + ':' + Math.floor(count / 2))
  selected.status = selected.status === 'dismissed' ? 'ready' : 'dismissed'
  const update = await measure(() => repository.put(selected))
  repository.db.close()
  jobs = null
  const warmRepository = new globalThis.XboostJobRepository.JobRepository(browser)
  const warmStartup = await measure(() => warmRepository.init(value => String(value || '').toLowerCase(), null))
  warmStartup.value = null
  warmRepository.db.close()
  if (globalThis.gc) globalThis.gc()
  const output = {
    engine: navigator.userAgent,
    jobs: count,
    fixtureBytes: oldSerialize.value,
    oldFullSerializeMs: Number(oldSerialize.milliseconds.toFixed(2)),
    oldFullPageSortP95Ms: Number(percentile(oldPages).toFixed(2)),
    migrationMs: Number(migration.milliseconds.toFixed(2)),
    compactHeaders: headerCount,
    warmStartupMs: Number(warmStartup.milliseconds.toFixed(2)),
    indexedPageP95Ms: Number(percentile(pageTimes).toFixed(2)),
    oneJobUpdateMs: Number(update.milliseconds.toFixed(2)),
    cachedCandidateScreeningPer1000Ms: Number(screening.milliseconds.toFixed(2)),
    pageBodies: first.jobs.length,
    storageWrites,
    storageBytes,
    heapUsedMiB: performance.memory ? Number((performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)) : null
  }
  document.getElementById('result').textContent = JSON.stringify(output)
})().catch(error => { document.getElementById('result').textContent = JSON.stringify({ error: error.stack || error.message }) })
