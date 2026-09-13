/* global browser */
'use strict'

const dialogs = globalThis.XboostDialog
const el = id => document.getElementById(id)
let refreshing = false
let pendingRefresh = null
let queueRequest = 0
let viewId = ''
let totalPages = 1
let lastJobs = ''
let configured = false
const edits = new Map()
const editTimers = new Map()
const panelId = globalThis.crypto?.randomUUID?.() || `panel-${Date.now()}-${Math.random()}`
const pagination = globalThis.XboostQueuePagination
let currentPage = 1
let currentJobs = []
let profileFilter = '*'
let profileFilterSignature = ''
const filterViews = new Map()
let restoreScroll = null
el('drafts-top').onclick = () => el('drafts').querySelector('.card')?.scrollIntoView({ block: 'start' })
el('drafts-bottom').onclick = () => [...el('drafts').querySelectorAll('.card')].at(-1)?.scrollIntoView({ block: 'end' })
el('page-first').onclick = () => refreshQueue(false, 1).catch(error)
el('page-previous').onclick = () => navigatePage(-1)
el('page-next').onclick = () => navigatePage(1)
el('page-last').onclick = () => refreshQueue(false, totalPages).catch(error)
el('page-go').onclick = () => refreshQueue(false, Number(el('page-number').value)).catch(error)
el('page-number').onkeydown = event => { if (event.key === 'Enter') el('page-go').click() }
el('queue-new').onclick = () => { viewId = ''; refreshQueue(false, 1, true).catch(error) }
el('draft-profile-filter').onchange = () => changeProfileFilter(el('draft-profile-filter').value)
const panelPort = browser.runtime.connect({ name: 'xboost:ai-panel' })
panelPort.onDisconnect.addListener(() => {
  el('automode').checked = false
  el('automode').disabled = true
  error(new Error('Background connection closed. Reload this panel to reconnect.'))
})
panelPort.onMessage?.addListener(message => {
  if (message?.type === 'queue-revision') refreshQueue(true).catch(error)
  if (['queue-revision', 'session-revision'].includes(message?.type)) window.xboostSessionRevision?.()
})

async function call (action, fields = {}) {
  const result = await browser.runtime.sendMessage({ type: 'xboost:ai', action, ...fields })
  if (!result?.ok) throw new Error(result?.error || 'Extension unavailable')
  return result.data
}

function error (value) { el('error').textContent = value.message || String(value) }

async function discoveryTabs () {
  const tabs = await call('discovery-tabs')
  const select = el('discovery-tab')
  const selected = select.value
  select.replaceChildren()
  for (const tab of tabs) {
    const option = document.createElement('option')
    option.value = String(tab.id)
    option.textContent = tab.title
    select.append(option)
  }
  if (tabs.some(tab => String(tab.id) === selected)) select.value = selected
  el('refresh-posts').disabled = !tabs.length
  el('more-posts').disabled = !tabs.length
}
for (const [id, mode] of [['new-search', 'new-search'], ['refresh-posts', 'refresh'], ['more-posts', 'more']]) {
  el(id).addEventListener('click', async () => {
    el(id).disabled = true
    try {
      const result = await call('discover', { mode, tabId: Number(el('discovery-tab').value) })
      el('discovery-status').textContent = result.message + ' Sending replies remains manual.'
    } catch (value) { el('discovery-status').textContent = value.message } finally {
      el(id).disabled = false
      discoveryTabs().catch(error)
    }
  })
}
discoveryTabs().catch(error)
window.addEventListener('focus', () => { discoveryTabs().catch(error) })

el('automode').addEventListener('change', () => {
  el('automode').disabled = true
  call('control', { enabled: el('automode').checked }).then(refresh).catch(value => {
    el('automode').checked = false
    error(value)
    el('automode').disabled = false
  })
})

async function refreshQueue (preservePosition = true, requestedPage = currentPage, refreshSnapshot = false) {
  if (refreshing) {
    queueRequest++
    if (!pendingRefresh || !preservePosition) pendingRefresh = { preservePosition, requestedPage, refreshSnapshot }
    return
  }
  refreshing = true
  const requestId = ++queueRequest
  try {
    const data = await call('queue-page', { page: requestedPage, profileFilter, viewId, refreshSnapshot })
    if (requestId !== queueRequest) return
    viewId = data.queue.viewId
    filterViews.set(profileFilter, { page: data.queue.page, viewId, scrollY: restoreScroll ?? window.scrollY })
    const signature = JSON.stringify({ jobs: data.jobs, queue: data.queue })
    if (signature !== lastJobs) { renderJobs(data.jobs, preservePosition, data.queue); lastJobs = signature }
  } finally {
    refreshing = false
    const pending = pendingRefresh
    pendingRefresh = null
    if (pending) refreshQueue(pending.preservePosition, pending.requestedPage, pending.refreshSnapshot).catch(error)
  }
}

function navigatePage (delta) {
  const base = pendingRefresh?.requestedPage ?? currentPage
  refreshQueue(false, base + delta).catch(error)
}

function changeProfileFilter (next) {
  filterViews.set(profileFilter, { page: currentPage, viewId, scrollY: window.scrollY })
  profileFilter = next
  const saved = filterViews.get(next)
  currentPage = saved?.page || 1
  viewId = saved?.viewId || ''
  restoreScroll = saved?.scrollY ?? null
  refreshQueue(false, currentPage, !saved).catch(error)
}

async function refreshConnection () {
  const data = await call('status')
  el('error').textContent = ''
  el('automode').checked = data.enabled
  el('automode').disabled = !data.account
  el('server-status').textContent = `${data.account ? `Signed in (${data.account.planType || data.account.type})` : 'Sign-in required'} · ${data.enabled ? 'Auto-drafting on' : 'Paused'}${data.lastError ? ` · ${data.lastError}` : ''}`
  const limit = data.limits?.rateLimits
  el('limits').textContent = limit ? `Codex usage: ${JSON.stringify(limit)}` : 'Codex usage limits are unavailable until sign-in or not reported by this plan.'
}

async function refresh () {
  await Promise.all([refreshQueue(), refreshConnection()])
}

function renderJobs (jobs, preservePosition = true, queueState = null) {
  currentJobs = jobs
  const active = document.activeElement?.tagName === 'TEXTAREA' ? document.activeElement : null
  const activeId = active?.dataset?.jobId
  const activeState = active && { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection, scrollTop: active.scrollTop }
  const activeCard = activeId && document.getElementById('job-' + activeId)
  const existingCards = new Map([...el('drafts').children].filter(node => node.id?.startsWith('job-')).map(node => [node.id.slice(4), node]))
  const profiles = queueState?.paged
    ? new Map(queueState.profiles.map(item => [item.key, item.label]))
    : new Map(jobs.filter(job => job.status !== 'dismissed' || job.repliedAt).map(job => [pagination.key(job), `${pagination.profile(job)} · @${job.expectedHandle}`]))
  if (queueState?.paged) profileFilter = queueState.profileFilter
  const nextFilterSignature = JSON.stringify([...profiles])
  if (nextFilterSignature !== profileFilterSignature) {
    profileFilterSignature = nextFilterSignature
    const select = el('draft-profile-filter')
    select.replaceChildren()
    const all = document.createElement('option')
    all.value = '*'
    all.textContent = 'All profiles'
    select.append(all)
    for (const [key, label] of [...profiles].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))) {
      const option = document.createElement('option')
      option.value = key
      option.textContent = label
      select.append(option)
    }
    if (profileFilter !== '*' && !profiles.has(profileFilter)) profileFilter = '*'
    select.value = profileFilter
  }
  const boundary = el('queue-controls').getBoundingClientRect?.().bottom || 0
  const anchor = [...el('drafts').children].find(card => card.id && card.getBoundingClientRect().bottom > boundary)
  const offset = anchor?.getBoundingClientRect().top
  const anchorId = anchor?.id
  const filtered = profileFilter === '*' ? jobs : jobs.filter(job => pagination.key(job) === profileFilter)
  const page = queueState?.paged
    ? { items: jobs, page: queueState.page, pages: queueState.pages, total: queueState.total }
    : pagination.paginate(filtered, currentPage, 25, anchorId?.slice(4))
  currentPage = page.page
  totalPages = page.pages
  el('page-number').value = String(page.page)
  el('page-number').max = String(page.pages)
  el('page-status').textContent = `Page ${page.page} of ${page.pages} · ${page.total} drafts`
  const newCount = Number(queueState?.newCount) || 0
  el('queue-new').hidden = !newCount
  el('queue-new').textContent = `Show ${newCount} new draft${newCount === 1 ? '' : 's'}`
  el('page-first').disabled = page.page <= 1
  el('page-previous').disabled = page.page <= 1
  el('page-next').disabled = page.page >= page.pages
  el('page-last').disabled = page.page >= page.pages
  const rendered = []
  let renderedProfile
  for (const job of page.items) {
    const profile = pagination.profile(job) + ' · @' + job.expectedHandle
    if (profile !== renderedProfile) {
      const group = document.createElement('button')
      group.type = 'button'
      group.className = 'draft-profile-heading'
      group.textContent = profile + (profileFilter === '*' ? ' · show only this profile' : '')
      group.onclick = () => {
        const next = pagination.key(job)
        el('draft-profile-filter').value = next
        if (queueState?.paged) {
          changeProfileFilter(next)
        } else renderJobs(currentJobs, false)
      }
      rendered.push(group)
      renderedProfile = profile
    }
    const existing = existingCards.get(job.id)
    const cardSignature = JSON.stringify(job)
    if (existing && (job.id === activeId || existing.dataset?.signature === cardSignature)) {
      if (job.id === activeId) patchActiveCard(existing, job)
      rendered.push(existing)
      continue
    }
    const card = document.createElement('article')
    card.dataset ||= {}
    card.dataset.signature = cardSignature
    card.id = 'job-' + job.id
    card.tabIndex = -1
    card.className = 'card'
    const heading = document.createElement('h2')
    heading.dataset ||= {}
    heading.dataset.jobHeading = ''
    heading.textContent = jobHeading(job)
    const source = document.createElement('a')
    source.textContent = `Post by @${job.post.author}`
    source.href = `https://x.com/${encodeURIComponent(job.post.author)}/status/${encodeURIComponent(job.post.id)}`
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    const text = document.createElement('p')
    text.textContent = job.post.text
    card.append(heading, source, text)
    const records = job.replyRecords || jobs.filter(item => item.post.id === job.post.id && item.repliedAt)
    if (records.length) {
      const ledger = document.createElement('p')
      ledger.textContent = 'Marked replied (your confirmation): ' + records.map(item => '@' + item.expectedHandle + ' · ' + new Date(item.repliedAt).toLocaleString()).join('; ')
      card.append(ledger)
    }
    if (job.text && job.status === 'ready') {
      const draft = document.createElement('textarea')
      draft.dataset ||= {}
      draft.dataset.jobId = job.id
      draft.value = edits.get(job.id)?.text ?? job.localEdit?.text ?? job.text
      draft.dataset.editUpdatedAt = edits.get(job.id)?.expectedUpdatedAt ?? job.localEdit?.updatedAt ?? ''
      draft.addEventListener('input', () => {
        edits.set(job.id, { text: draft.value, expectedUpdatedAt: draft.dataset.editUpdatedAt || null })
        scheduleEditSave(job.id)
      })
      draft.addEventListener('blur', () => {
        saveLocalEdit(job.id).catch(error)
        refreshQueue(true).catch(error)
      })
      draft.rows = 5
      draft.setAttribute('aria-label', `Reply draft for @${job.expectedHandle}`)
      const copy = document.createElement('button')
      copy.className = 'button'
      copy.textContent = 'Copy edited draft'
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(draft.value).then(() => { copy.textContent = 'Copied' }).catch(error)
      })
      card.append(draft, copy)
      const prepare = document.createElement('button')
      prepare.className = 'button primary'
      prepare.textContent = 'Prepare reply on X'
      prepare.addEventListener('click', () => {
        prepare.disabled = true
        call('prepare', { id: job.id, text: draft.value }).then(() => {
          prepare.textContent = 'Opened on X — review and send there'
        }).catch(error).finally(() => { prepare.disabled = false })
      })
      card.append(prepare)
      const mark = document.createElement('button')
      mark.className = 'button'
      mark.textContent = 'Mark replied'
      mark.onclick = async () => {
        if (await dialogs.confirm({ title: 'Mark this draft as replied?', message: `Confirm you sent a reply to this post from @${job.expectedHandle}. This records it locally; it does not post to X.`, confirmLabel: 'Mark replied' })) {
          call('mark-replied', { id: job.id, text: draft.value }).then(refresh).catch(error)
        }
      }
      card.append(mark)
    }
    if (job.repliedAt) {
      const sent = document.createElement('p')
      sent.textContent = job.sentText || job.text
      const undo = document.createElement('button')
      undo.className = 'button'
      undo.textContent = 'Undo replied mark'
      undo.onclick = () => { call('mark-replied', { id: job.id, undo: true }).then(refresh).catch(error) }
      card.append(sent, undo)
    }
    if (job.error) {
      const detail = document.createElement('p')
      detail.textContent = job.error
      card.append(detail)
    }
    if (job.status === 'skipped') {
      const reason = document.createElement('p')
      reason.textContent = `Skipped: ${job.skipReason || 'Earlier draft did not include a reason. Retry for an explanation.'}`
      card.append(reason)
    }
    if (['skipped', 'failed', 'interrupted'].includes(job.status)) {
      const retry = document.createElement('button')
      retry.className = 'button'
      retry.textContent = 'Retry draft'
      retry.addEventListener('click', () => {
        edits.delete(job.id)
        if (editTimers.has(job.id)) window.clearTimeout?.(editTimers.get(job.id))
        editTimers.delete(job.id)
        call('retry', { id: job.id }).then(refresh).catch(error)
      })
      card.append(retry)
    }
    if (job.status !== 'running' && !job.repliedAt) {
      const dismiss = document.createElement('button')
      dismiss.className = 'button'
      dismiss.textContent = 'Dismiss'
      dismiss.addEventListener('click', () => { call('dismiss', { id: job.id }).then(refresh).catch(error) })
      card.append(dismiss)
    }
    rendered.push(card)
  }
  reconcileChildren(el('drafts'), rendered)
  if (activeCard && activeState && rendered.includes(activeCard)) {
    const draft = activeCard.querySelector?.('textarea') || activeCard.children?.find(child => child.tagName === 'TEXTAREA')
    draft?.focus?.({ preventScroll: true })
    draft?.setSelectionRange?.(activeState.start, activeState.end, activeState.direction)
    if (draft) draft.scrollTop = activeState.scrollTop
  }
  const restored = anchorId && document.getElementById(anchorId)
  if (preservePosition && restored && offset < window.innerHeight) window.scrollBy(0, restored.getBoundingClientRect().top - offset)
  if (restoreScroll !== null) {
    window.scrollTo?.({ top: restoreScroll })
    restoreScroll = null
  } else if (!preservePosition) el('drafts').scrollIntoView({ block: 'start' })
}

function scheduleEditSave (id) {
  if (!window.setTimeout) return
  if (editTimers.has(id)) window.clearTimeout?.(editTimers.get(id))
  editTimers.set(id, window.setTimeout(() => {
    editTimers.delete(id)
    saveLocalEdit(id).catch(error)
  }, 300))
}

async function saveLocalEdit (id) {
  const pending = edits.get(id)
  if (!pending) return
  const result = await call('save-edit', { id, text: pending.text, writer: panelId, expectedUpdatedAt: pending.expectedUpdatedAt })
  if (result.conflict) {
    error(new Error('This draft was edited in another Xboost panel. Your unsaved text is preserved here; reload before choosing which version to keep.'))
    return
  }
  const current = edits.get(id)
  if (!current || current.text !== pending.text) return
  const draft = document.getElementById('job-' + id)?.querySelector?.('textarea')
  if (draft) draft.dataset.editUpdatedAt = result.value.updatedAt
  edits.delete(id)
}

function jobHeading (job) {
  let value = `@${job.expectedHandle} · ${job.status}`
  if (job.source === 'manual') value += ' · manually selected'
  if (job.source === 'discovery') value += ' · discovery'
  if (job.discoveryEligibility) value += ' · ' + job.discoveryEligibility
  return value
}

function patchActiveCard (card, job) {
  const heading = card.querySelector?.('[data-job-heading]') || card.children?.find(child => child.dataset && Object.hasOwn(child.dataset, 'jobHeading'))
  if (heading) heading.textContent = jobHeading(job)
  card.dataset.signature = JSON.stringify(job)
}

function reconcileChildren (parent, desired) {
  if (!parent.insertBefore || parent.firstChild === undefined) {
    parent.replaceChildren(...desired)
    return
  }
  let current = parent.firstChild
  for (const node of desired) {
    if (node === current) current = current.nextSibling
    else parent.insertBefore(node, current)
  }
  while (current) {
    const next = current.nextSibling
    current.remove()
    current = next
  }
}

async function loadConfiguration () {
  const config = await call('config')
  configured = config.configured
  if (configured) await refresh()
  else {
    el('automode').disabled = true
    el('server-status').textContent = 'Connect Codex in Settings first.'
    const data = await call('queue-page', { page: currentPage, profileFilter, viewId })
    viewId = data.queue.viewId
    if (document.activeElement?.tagName !== 'TEXTAREA') renderJobs(data.jobs, true, data.queue)
  }
}
loadConfiguration().catch(error)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['xboost:ai']) loadConfiguration().catch(error)
})
window.setInterval(() => {
  if (configured) refreshConnection().catch(error)
  else if (!configured && document.activeElement?.tagName !== 'TEXTAREA') loadConfiguration().catch(error)
}, 30000)
