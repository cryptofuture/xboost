'use strict'

;(function (root) {
  const DB_NAME = 'xboost-ai'
  const DB_VERSION = 2
  const JOBS = 'jobs'
  const SNAPSHOTS = 'snapshots'
  const META = 'meta'
  const EDITS = 'edits'
  const LEGACY_JOBS = 'xboost:ai-jobs'
  const LEGACY_SNAPSHOTS = 'xboost:ai-profile-snapshots'
  const VIEW_LIMIT = 20
  const VIEW_TTL = 30 * 60 * 1000
  const MIGRATION_BATCH = 500

  const request = value => new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error || new Error('IndexedDB request failed'))
  })
  const transaction = value => new Promise((resolve, reject) => {
    value.oncomplete = () => resolve()
    value.onabort = value.onerror = () => reject(value.error || new Error('IndexedDB transaction failed'))
  })
  const visible = job => job.status !== 'dismissed' || Boolean(job.repliedAt)
  const profileName = job => String(job.profileName || job.accountSnapshot?.product || job.expectedHandle || job.profileId || '')
  const timestamp = job => {
    const value = Date.parse(job.createdAt || job.repliedAt || '')
    return Number.isFinite(value) ? value : 0
  }
  function stored (job, sequence) {
    return {
      ...job,
      _seq: Number(job._seq) || sequence,
      _visible: visible(job) ? 1 : 0,
      _profileSort: profileName(job).toLocaleLowerCase(),
      _orderTime: -timestamp(job)
    }
  }
  function publicJob (job) {
    if (!job) return job
    const result = { ...job }
    for (const key of ['_seq', '_visible', '_profileSort', '_orderTime']) delete result[key]
    return result
  }
  function header (job, normalize = value => String(value || ''), activeSessionId) {
    const activeSession = Boolean(activeSessionId && job.sessionId === activeSessionId)
    return {
      id: job.id,
      sessionId: job.sessionId,
      profileId: job.profileId,
      profileRevision: job.profileRevision,
      profileName: profileName(job),
      expectedHandle: job.expectedHandle,
      post: { id: job.post?.id, author: job.post?.author, postedAt: job.post?.postedAt },
      source: job.source,
      status: job.status,
      createdAt: job.createdAt,
      repliedAt: job.repliedAt,
      hasText: Boolean(job.text?.trim()),
      normalizedPost: activeSession ? normalize(job.post?.text) : undefined,
      normalizedDraft: activeSession ? normalize(job.text) : undefined,
      _seq: job._seq
    }
  }
  function compare (left, right) {
    return profileName(left).localeCompare(profileName(right), undefined, { sensitivity: 'base' }) ||
      timestamp(right) - timestamp(left) || String(left.id).localeCompare(String(right.id))
  }

  class JobRepository {
    constructor (browser, database = root.indexedDB) {
      this.browser = browser
      this.database = database
      this.fallback = !database
      this.jobs = []
      this.snapshots = {}
      this.sequence = 0
      this.views = new Map()
      this.profileCounts = new Map()
    }

    async init (normalize, activeSessionId) {
      this.normalize = normalize
      this.activeSessionId = activeSessionId
      if (this.fallback) {
        const data = await this.browser.storage.local.get([LEGACY_JOBS, LEGACY_SNAPSHOTS])
        this.snapshots = data[LEGACY_SNAPSHOTS] || {}
        this.jobs = (data[LEGACY_JOBS] || []).map(job => {
          const value = { ...job }
          if (value.accountSnapshot?.context && value.profileRevision) {
            this.snapshots[value.profileRevision] = value.accountSnapshot
            value.profileName ||= value.accountSnapshot.product
            delete value.accountSnapshot
          }
          return stored(value, ++this.sequence)
        })
        await this.browser.storage.local.set({ [LEGACY_JOBS]: this.jobs.map(publicJob), [LEGACY_SNAPSHOTS]: this.snapshots })
        this.recount()
        return this.jobs.map(job => header(job, normalize, this.activeSessionId))
      }
      this.db = await this.open()
      await this.migrate()
      return this.scanHeaders()
    }

    open () {
      return new Promise((resolve, reject) => {
        const opening = this.database.open(DB_NAME, DB_VERSION)
        opening.onupgradeneeded = () => {
          const db = opening.result
          const jobs = db.objectStoreNames.contains(JOBS) ? opening.transaction.objectStore(JOBS) : db.createObjectStore(JOBS, { keyPath: 'id' })
          if (!jobs.indexNames.contains('queue')) jobs.createIndex('queue', ['_visible', '_profileSort', '_orderTime', 'id'])
          if (!jobs.indexNames.contains('profileQueue')) jobs.createIndex('profileQueue', ['_visible', 'profileId', '_orderTime', 'id'])
          if (!jobs.indexNames.contains('post')) jobs.createIndex('post', ['profileId', 'post.id'])
          if (!jobs.indexNames.contains('source')) jobs.createIndex('source', 'post.id')
          if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'revision' })
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
          if (!db.objectStoreNames.contains(EDITS)) db.createObjectStore(EDITS, { keyPath: 'jobId' })
        }
        opening.onsuccess = () => resolve(opening.result)
        opening.onerror = () => reject(opening.error || new Error('Cannot open Xboost draft storage'))
      })
    }

    async migrate () {
      const read = this.db.transaction(META, 'readonly')
      const marker = await request(read.objectStore(META).get('migration-v1'))
      if (marker?.complete) {
        await this.browser.storage.local.remove?.([LEGACY_JOBS, LEGACY_SNAPSHOTS])
        return
      }
      const legacy = await this.browser.storage.local.get([LEGACY_JOBS, LEGACY_SNAPSHOTS])
      const legacyJobs = legacy[LEGACY_JOBS] || []
      const legacySnapshots = legacy[LEGACY_SNAPSHOTS] || {}
      let start = Math.max(0, Math.min(legacyJobs.length, Number(marker?.nextIndex) || 0))
      while (start < legacyJobs.length) {
        const end = Math.min(legacyJobs.length, start + MIGRATION_BATCH)
        const tx = this.db.transaction([JOBS, SNAPSHOTS, META], 'readwrite')
        const jobStore = tx.objectStore(JOBS)
        const snapshotStore = tx.objectStore(SNAPSHOTS)
        if (start === 0) for (const [revision, account] of Object.entries(legacySnapshots)) snapshotStore.put({ revision, account })
        for (let index = start; index < end; index++) {
          const value = { ...legacyJobs[index] }
          if (value.accountSnapshot?.context && value.profileRevision) {
            snapshotStore.put({ revision: value.profileRevision, account: value.accountSnapshot })
            value.profileName ||= value.accountSnapshot.product
            delete value.accountSnapshot
          }
          jobStore.put(stored(value, index + 1))
        }
        tx.objectStore(META).put({ key: 'migration-v1', complete: false, nextIndex: end, migratedJobs: end })
        await transaction(tx)
        start = end
      }
      const validation = this.db.transaction(JOBS, 'readonly')
      const count = await request(validation.objectStore(JOBS).count())
      const expected = new Set(legacyJobs.map(job => job.id)).size
      if (count < expected) throw new Error(`Draft migration validation failed: expected ${expected}, found ${count}`)
      const completed = this.db.transaction(META, 'readwrite')
      completed.objectStore(META).put({ key: 'migration-v1', complete: true, nextIndex: legacyJobs.length, migratedJobs: expected, completedAt: new Date().toISOString() })
      await transaction(completed)
      await this.browser.storage.local.remove?.([LEGACY_JOBS, LEGACY_SNAPSHOTS])
    }

    async all () {
      if (this.fallback) return this.jobs
      const tx = this.db.transaction(JOBS, 'readonly')
      return request(tx.objectStore(JOBS).getAll())
    }

    scanHeaders () {
      return new Promise((resolve, reject) => {
        const result = []
        this.profileCounts.clear()
        const tx = this.db.transaction(JOBS, 'readonly')
        const cursor = tx.objectStore(JOBS).openCursor()
        cursor.onerror = () => reject(cursor.error || new Error('Cannot read draft index'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) { resolve(result); return }
          const job = item.value
          this.sequence = Math.max(this.sequence, Number(job._seq) || 0)
          result.push(header(job, this.normalize, this.activeSessionId))
          if (visible(job)) {
            const id = String(job.profileId || job.expectedHandle)
            const count = this.profileCounts.get(id) || { key: id, label: `${profileName(job)} · @${job.expectedHandle}`, total: 0 }
            count.total++
            this.profileCounts.set(id, count)
          }
          item.continue()
        }
      })
    }

    recount (values = this.jobs) {
      this.profileCounts.clear()
      for (const job of values) {
        if (!visible(job)) continue
        const id = String(job.profileId || job.expectedHandle)
        const count = this.profileCounts.get(id) || { key: id, label: `${profileName(job)} · @${job.expectedHandle}`, total: 0 }
        count.total++
        this.profileCounts.set(id, count)
      }
    }

    updateCounts (before, after) {
      if (before && visible(before)) {
        const id = String(before.profileId || before.expectedHandle)
        const count = this.profileCounts.get(id)
        if (count && --count.total <= 0) this.profileCounts.delete(id)
      }
      if (after && visible(after)) {
        const id = String(after.profileId || after.expectedHandle)
        const count = this.profileCounts.get(id) || { key: id, label: `${profileName(after)} · @${after.expectedHandle}`, total: 0 }
        count.label = `${profileName(after)} · @${after.expectedHandle}`
        count.total++
        this.profileCounts.set(id, count)
      }
    }

    updateViews (before, after) {
      const now = Date.now()
      for (const [id, view] of this.views) {
        if (now - view.usedAt > VIEW_TTL) { this.views.delete(id); continue }
        const inFilter = job => job && (view.filter === '*' || String(job.profileId || job.expectedHandle) === view.filter)
        const matches = job => inFilter(job) && visible(job) && Number(job._seq) <= view.maxSeq
        const isNew = job => inFilter(job) && visible(job) && Number(job._seq) > view.maxSeq
        if (matches(before) || matches(after)) view.pages.clear()
        if (matches(before) && !matches(after)) view.total--
        if (!matches(before) && matches(after)) view.total++
        if (isNew(before) && !isNew(after)) view.newCount--
        if (!isNew(before) && isNew(after)) view.newCount++
      }
    }

    async get (id) {
      if (this.fallback) return publicJob(this.jobs.find(job => job.id === id))
      const tx = this.db.transaction(JOBS, 'readonly')
      return publicJob(await request(tx.objectStore(JOBS).get(id)))
    }

    async put (job) {
      let before
      let value
      if (this.fallback) {
        const index = this.jobs.findIndex(item => item.id === job.id)
        before = index >= 0 ? this.jobs[index] : null
        value = stored(job, before?._seq || ++this.sequence)
        if (index >= 0) this.jobs[index] = value
        else this.jobs.push(value)
        await this.browser.storage.local.set({ [LEGACY_JOBS]: this.jobs.map(publicJob), [LEGACY_SNAPSHOTS]: this.snapshots })
      } else {
        const tx = this.db.transaction(JOBS, 'readwrite')
        const store = tx.objectStore(JOBS)
        before = await request(store.get(job.id))
        value = stored(job, before?._seq || ++this.sequence)
        store.put(value)
        await transaction(tx)
      }
      this.updateViews(before, value)
      this.updateCounts(before, value)
      return header(value, this.normalize, this.activeSessionId)
    }

    async setActiveSession (sessionId) {
      this.activeSessionId = sessionId
      const affected = []
      for (const item of await this.sessionJobs(sessionId)) affected.push(header(item, this.normalize, this.activeSessionId))
      return affected
    }

    sessionJobs (sessionId) {
      if (!sessionId) return Promise.resolve([])
      if (this.fallback) return Promise.resolve(this.jobs.filter(job => job.sessionId === sessionId))
      return new Promise((resolve, reject) => {
        const result = []
        const tx = this.db.transaction(JOBS, 'readonly')
        const cursor = tx.objectStore(JOBS).openCursor()
        cursor.onerror = () => reject(cursor.error || new Error('Cannot load discovery draft index'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) { resolve(result); return }
          if (item.value.sessionId === sessionId) result.push(item.value)
          item.continue()
        }
      })
    }

    async putSnapshot (revision, account) {
      if (!revision || !account?.context) return
      if (this.fallback) {
        this.snapshots[revision] = account
        await this.browser.storage.local.set({ [LEGACY_SNAPSHOTS]: this.snapshots })
        return
      }
      const tx = this.db.transaction(SNAPSHOTS, 'readwrite')
      tx.objectStore(SNAPSHOTS).put({ revision, account })
      await transaction(tx)
    }

    async getSnapshot (revision) {
      if (this.fallback) return this.snapshots[revision]
      const tx = this.db.transaction(SNAPSHOTS, 'readonly')
      return (await request(tx.objectStore(SNAPSHOTS).get(revision)))?.account
    }

    async getEdits (ids) {
      if (this.fallback) return []
      const tx = this.db.transaction(EDITS, 'readonly')
      const store = tx.objectStore(EDITS)
      return (await Promise.all(ids.map(id => request(store.get(id))))).filter(Boolean)
    }

    async putEdit (input) {
      if (this.fallback) return { value: { jobId: input.jobId, text: input.text, writer: input.writer, updatedAt: new Date().toISOString() } }
      const tx = this.db.transaction(EDITS, 'readwrite')
      const store = tx.objectStore(EDITS)
      const current = await request(store.get(input.jobId))
      const expected = input.expectedUpdatedAt || null
      if (current && current.updatedAt !== expected && current.writer !== input.writer) return { conflict: true, current }
      const value = { jobId: input.jobId, text: input.text, writer: input.writer, updatedAt: new Date().toISOString() }
      store.put(value)
      await transaction(tx)
      return { value }
    }

    async deleteEdit (jobId) {
      if (this.fallback) return
      const tx = this.db.transaction(EDITS, 'readwrite')
      tx.objectStore(EDITS).delete(jobId)
      await transaction(tx)
    }

    createView (filter) {
      const id = root.crypto.randomUUID()
      const total = filter === '*' ? [...this.profileCounts.values()].reduce((sum, value) => sum + value.total, 0) : this.profileCounts.get(filter)?.total || 0
      const view = { id, filter, maxSeq: this.sequence, total, newCount: 0, usedAt: Date.now(), pages: new Map() }
      this.views.set(id, view)
      while (this.views.size > VIEW_LIMIT) this.views.delete(this.views.keys().next().value)
      return view
    }

    view (id, filter, reset) {
      let view = !reset && this.views.get(id)
      if (!view || view.filter !== filter || Date.now() - view.usedAt > VIEW_TTL) view = this.createView(filter)
      view.usedAt = Date.now()
      return view
    }

    async page (input = {}) {
      const requestedFilter = input.profileFilter && input.profileFilter !== '*' ? String(input.profileFilter) : '*'
      const filter = requestedFilter !== '*' && !this.profileCounts.has(requestedFilter) ? '*' : requestedFilter
      const view = this.view(input.viewId, filter, input.refreshSnapshot)
      const size = Math.max(1, Math.min(100, Number(input.pageSize) || 25))
      const pages = Math.max(1, Math.ceil(view.total / size))
      const page = Math.max(1, Math.min(pages, Number(input.page) || 1))
      const offset = (page - 1) * size
      const cacheKey = `${size}:${page}`
      const cachedPage = view.pages.get(cacheKey)
      let items
      if (cachedPage) {
        view.pages.delete(cacheKey)
        view.pages.set(cacheKey, cachedPage)
        items = cachedPage
      } else {
        const values = this.fallback ? this.jobs.slice().sort(compare) : await this.cursorPage(filter, view.maxSeq, offset, size, view.newCount === 0)
        items = this.fallback
          ? values.filter(job => visible(job) && Number(job._seq) <= view.maxSeq && (filter === '*' || String(job.profileId || job.expectedHandle) === filter)).slice(offset, offset + size)
          : values
      }
      if (!view.pages.has(cacheKey)) {
        view.pages.set(cacheKey, items)
        while (view.pages.size > 3) view.pages.delete(view.pages.keys().next().value)
      }
      return {
        jobs: items.map(publicJob),
        queue: { paged: true, page, pages, total: view.total, profileFilter: filter, profiles: [...this.profileCounts.values()].map(({ key, label }) => ({ key, label })), viewId: view.id, newCount: view.newCount }
      }
    }

    cursorPage (filter, maxSeq, offset, size, fastSkip) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(JOBS, 'readonly')
        const index = tx.objectStore(JOBS).index(filter === '*' ? 'queue' : 'profileQueue')
        const lower = filter === '*' ? [1, '', Number.MIN_SAFE_INTEGER, ''] : [1, filter, Number.MIN_SAFE_INTEGER, '']
        const upper = filter === '*' ? [1, '\uffff', Number.MAX_SAFE_INTEGER, '\uffff'] : [1, filter, Number.MAX_SAFE_INTEGER, '\uffff']
        const cursor = index.openCursor(root.IDBKeyRange.bound(lower, upper))
        const result = []
        let matched = 0
        let advanced = false
        cursor.onerror = () => reject(cursor.error || new Error('Cannot read draft page'))
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item || result.length >= size) { resolve(result); return }
          if (fastSkip && offset > 0 && !advanced) {
            advanced = true
            matched = offset
            item.advance(offset)
            return
          }
          if (Number(item.value._seq) <= maxSeq) {
            if (matched >= offset) result.push(item.value)
            matched++
          }
          item.continue()
        }
      })
    }
  }

  root.XboostJobRepository = { JobRepository, header, publicJob, visible, compare }
  if (typeof module !== 'undefined') module.exports = root.XboostJobRepository
})(globalThis)
