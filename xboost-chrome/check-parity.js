'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const shared = ['ai.js', 'content.js', 'discovery.js', 'discovery-ui.js', 'job-repository.js', 'queue-pagination.js', 'reply-context.js', 'shared.js', 'ui.css']
for (const file of shared) {
  const chrome = fs.readFileSync(path.join(__dirname, file))
  const firefox = fs.readFileSync(path.join(__dirname, '..', 'xboost', file))
  assert.deepEqual(chrome, firefox, `${file} drifted between the Firefox and Chrome extensions`)
}
console.log(`Firefox/Chrome parity: ${shared.length} shared modules match.`)
