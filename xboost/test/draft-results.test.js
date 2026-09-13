'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDraft, prepareDraft } = require('../reply-context')

test('skip reasons are separated from drafts and legacy skips remain retryable', () => {
  assert.deepEqual(parseDraft('SKIP: The post only contains an unexplained image.'), {
    status: 'skipped', text: '', skipReason: 'The post only contains an unexplained image.'
  })
  assert.equal(parseDraft(' SKIP ').status, 'skipped')
  assert.ok(parseDraft('SKIP').skipReason)
  assert.equal(parseDraft('Skip the spreadsheet and compare the data sources.').status, 'ready')
  assert.equal(parseDraft(' A useful conversational reply. ').text, 'A useful conversational reply.')
  assert.throws(() => parseDraft('  '), /no draft/)
  assert.equal(parseDraft('Useful — and practical – advice.').text, 'Useful - and practical - advice.')
  assert.equal(parseDraft('What’s your “project”? Founders’ tools and ‘open source’.').text, 'What\'s your "project"? Founders\' tools and "open source".')
})

test('prompt allows non-promotional conversation and requires specific skip reasons', async () => {
  const prompt = await prepareDraft('btcwid', { text: 'Comparing market data sources today.' }, async () => 'Product facts')
  assert.match(prompt.instructions, /does not require a product mention/)
  assert.match(prompt.instructions, /posts do not need to ask a question/)
  assert.match(prompt.instructions, /SKIP: followed by a short specific reason/)
  assert.match(prompt.instructions, /Do not invent capabilities/)
  assert.match(prompt.instructions, /Do not use em dashes/)
  assert.match(prompt.instructions, /natural contractions/)
  assert.match(prompt.instructions, /include its exact documented website URL/)
  assert.match(prompt.instructions, /prefer its documented GitHub repository/)
})
