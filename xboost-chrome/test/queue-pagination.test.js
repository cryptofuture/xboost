'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const pagination = require('../queue-pagination')

test('draft pager presents four equal-size navigation controls', () => {
  const html = require('node:fs').readFileSync(require.resolve('../ai.html'), 'utf8')
  const css = require('node:fs').readFileSync(require.resolve('../ui.css'), 'utf8')

  assert.match(html, /class="queue-page-actions"/)
  assert.match(css, /\.queue-page-actions \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.queue-page-actions \.button \{[^}]*width: 100%/)
})

test('drafts are grouped by profile and paged in sets of 25', () => {
  const jobs = Array.from({ length: 61 }, (_, index) => ({
    id: String(index),
    expectedHandle: index % 2 ? 'zebra' : 'alpha',
    status: 'ready',
    createdAt: new Date(2026, 0, index + 1).toISOString()
  }))
  const first = pagination.paginate(jobs, 1)
  const third = pagination.paginate(jobs, 3)
  assert.equal(first.items.length, 25)
  assert.equal(third.items.length, 11)
  assert.equal(third.pages, 3)
  assert.ok(first.items.every(job => job.expectedHandle === 'alpha'))
  assert.equal(pagination.paginate(jobs, 99).page, 3)
})

test('incoming drafts follow the visible anchor onto its new page', () => {
  const jobs = Array.from({ length: 75 }, (_, index) => ({
    id: String(index),
    profileId: 'btcwid',
    profileName: 'Bitcoin Monitor Widget',
    status: 'ready',
    createdAt: new Date(2026, 0, index + 1).toISOString()
  }))
  const anchor = pagination.paginate(jobs, 3).items[0]
  const incoming = Array.from({ length: 25 }, (_, index) => ({
    id: `new-${index}`,
    profileId: 'btcwid',
    profileName: 'Bitcoin Monitor Widget',
    status: 'ready',
    createdAt: new Date(2027, 0, index + 1).toISOString()
  }))
  const restored = pagination.paginate([...jobs, ...incoming], 3, 25, anchor.id)
  assert.equal(restored.page, 4)
  assert.ok(restored.items.some(job => job.id === anchor.id))
})
