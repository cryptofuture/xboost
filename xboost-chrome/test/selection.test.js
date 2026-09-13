'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { suggestions } = require('../selection')

test('local suggestions extract tags and phrases without URLs, handles or duplicates', () => {
  const terms = suggestions('Need historical balances for #Solana and #solana. Ask @someone https://example.com/private/path', ['Solana'])
  assert.ok(terms.includes('historical balances'))
  assert.ok(!terms.some(term => /solana|someone|example|https|private/i.test(term)))
  assert.equal(new Set(terms.map(term => term.toLowerCase())).size, terms.length)
  assert.ok(suggestions('#Kubernetes #工具').includes('工具'))
})
