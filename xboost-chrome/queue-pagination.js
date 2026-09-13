'use strict'
;(function (root) {
  const key = job => String(job.profileId || job.expectedHandle)
  const profile = job => String(job.profileName || job.accountSnapshot?.product || job.expectedHandle || job.profileId)
  function sorted (jobs) {
    return jobs.filter(job => job.status !== 'dismissed' || job.repliedAt).map((job, index) => ({ job, index })).sort((a, b) => {
      const order = profile(a.job).localeCompare(profile(b.job), undefined, { sensitivity: 'base' })
      if (order) return order
      const time = Date.parse(b.job.createdAt || b.job.repliedAt || '') - Date.parse(a.job.createdAt || a.job.repliedAt || '')
      return Number.isFinite(time) && time ? time : b.index - a.index
    }).map(item => item.job)
  }
  function paginate (jobs, requestedPage, size = 25, anchorId = '') {
    const all = sorted(jobs)
    const pages = Math.max(1, Math.ceil(all.length / size))
    const anchorIndex = anchorId ? all.findIndex(job => job.id === anchorId) : -1
    const wanted = anchorIndex >= 0 ? Math.floor(anchorIndex / size) + 1 : Number(requestedPage) || 1
    const page = Math.min(pages, Math.max(1, wanted))
    return { items: all.slice((page - 1) * size, page * size), page, pages, total: all.length }
  }
  root.XboostQueuePagination = { key, profile, sorted, paginate }
  if (typeof module !== 'undefined') module.exports = root.XboostQueuePagination
})(globalThis)
