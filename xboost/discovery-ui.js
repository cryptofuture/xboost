/* global browser */
'use strict'

;(function () {
  const el = id => document.getElementById(id)
  const dialogs = globalThis.XboostDialog
  let pending = 0
  let signature = ''
  let catalogReady = false
  let currentSession = null
  async function call (action, fields = {}) {
    const response = await browser.runtime.sendMessage({ type: 'xboost:ai', action, ...fields })
    if (!response?.ok) throw new Error(response?.error || 'Discovery unavailable')
    return response.data
  }
  function render (session) {
    currentSession = session
    const next = JSON.stringify(session)
    if (next === signature) return
    signature = next
    const boundary = el('queue-controls').getBoundingClientRect?.().bottom || 0
    const anchor = [...el('drafts').children].find(card => card.getBoundingClientRect().bottom > boundary)
    const offset = anchor?.getBoundingClientRect().top
    el('session-summary').textContent = session
      ? `${session.status} · ${session.profiles.reduce((sum, item) => sum + item.ready, 0)}/${session.target * session.profiles.length} ready · ${session.ageHours}h freshness window. ${session.reason}`
      : 'No discovery session yet. Start a session, then open searches one at a time.'
    const active = session && !['stopped', 'complete'].includes(session.status)
    el('session-start').disabled = Boolean(active)
    el('session-next').disabled = session?.status !== 'running'
    el('session-simple-search').disabled = session?.status !== 'running' || !session?.profiles[0]?.currentSearch
    el('session-pause').disabled = session?.status !== 'running'
    el('session-resume').disabled = session?.status !== 'paused'
    el('session-stop').disabled = !active
    el('session-restart').disabled = !catalogReady
    el('session-x-blocked').disabled = !active
    el('session-progress').replaceChildren()
    for (const profile of session?.profiles || []) {
      const row = document.createElement('article')
      row.className = 'card'
      const title = document.createElement('h3')
      title.textContent = `${profile.name}: ${profile.ready}/${session.target} ready · ${profile.state}`
      const numbers = document.createElement('p')
      numbers.textContent = `${profile.existing} existing · ${profile.generated} newly ready · ${profile.inspected} inspected · ${profile.awaiting} awaiting AI · ${profile.skipped} skipped/failed/interrupted · ${profile.rejected} rejected · ${profile.older} older/incompatible ready drafts`
      const search = document.createElement('p')
      search.textContent = profile.currentSearch ? 'Current search: ' + profile.currentSearch : 'Open next search to begin this profile.'
      const reason = document.createElement('p')
      reason.textContent = [profile.reason, profile.guidance, profile.nextRetryAt ? 'Revisit available after ' + new Date(profile.nextRetryAt).toLocaleTimeString() + '.' : ''].filter(Boolean).join(' ')
      const reasons = document.createElement('small')
      reasons.textContent = Object.entries(profile.rejectionReasons).map(([reason, count]) => `${reason}: ${count}`).join(' · ')
      row.append(title, numbers, search, reason, reasons)
      if (profile.state === 'profile changed') row.append(button('Accept current profile settings', 'session-accept-profile', profile.id))
      if (profile.nextRetryAt) row.append(button('Revisit searches after cooldown', 'session-revisit', profile.id))
      el('session-progress').append(row)
    }
    if (anchor && offset < window.innerHeight) window.scrollBy(0, anchor.getBoundingClientRect().top - offset)
  }
  function button (label, action, profileId) {
    const button = document.createElement('button')
    button.className = 'button'
    button.textContent = label
    button.onclick = () => run(action, { profileId })
    return button
  }
  async function run (action, fields = {}) {
    if (pending && !['session-pause', 'session-stop', 'session-restart', 'session-x-blocked'].includes(action)) return
    pending++
    el('session-error').textContent = ''
    try { render(await call(action, fields)) } catch (error) { el('session-error').textContent = error.message } finally { pending-- }
  }
  el('session-start').onclick = () => run('session-start', { profileId: el('session-profile').value, options: { target: el('session-target').value, ageHours: el('session-age').value, backlog: el('session-backlog').value, authorLimit: el('session-authors').value } })
  for (const action of ['next', 'simple-search', 'pause', 'resume', 'stop', 'x-blocked']) el('session-' + action).onclick = () => run('session-' + action)
  el('session-restart').onclick = async () => {
    const active = currentSession && !['stopped', 'complete'].includes(currentSession.status)
    const confirmed = await dialogs.confirm({
      title: active ? 'Force stop and start discovery over?' : 'Start discovery over?',
      message: active
        ? 'This interrupts queued or running work and resets search progress for the selected profile. Ready drafts, profile settings and reply history are preserved.'
        : 'This starts a fresh discovery session for the selected profile and resets previous search progress. Ready drafts, profile settings and reply history are preserved.',
      confirmLabel: active ? 'Stop and start over' : 'Start over',
      danger: true
    })
    if (confirmed) run('session-restart', { profileId: el('session-profile').value, options: { target: el('session-target').value, ageHours: el('session-age').value, backlog: el('session-backlog').value, authorLimit: el('session-authors').value } })
  }
  call('session-catalog').then(data => {
    for (const profile of data.profiles) {
      const option = document.createElement('option')
      option.value = profile.id
      option.textContent = `${profile.name} · @${profile.handle}`
      el('session-profile').append(option)
    }
    el('session-profile').value = data.activeId
    catalogReady = data.profiles.length > 0
    el('session-restart').disabled = !catalogReady
  }).catch(error => { el('session-error').textContent = error.message })
  const refresh = () => { if (!pending) call('session-status').then(render).catch(error => { el('session-error').textContent = error.message }) }
  window.xboostSessionRevision = refresh
  refresh()
  // Revisions cover normal changes. The slow read-only tick catches freshness
  // expiry even when no new job arrives.
  window.setInterval(refresh, 60000)
  window.addEventListener('focus', refresh)
})()
