'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')

test('Chrome requests WebSocket host permission for Codex', () => {
  const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'))
  assert.deepEqual(manifest.optional_host_permissions, ['ws://*/*', 'wss://*/*'])
  const settings = fs.readFileSync(require.resolve('../codex-settings.js'), 'utf8')
  assert.match(settings, /url\.protocol.*url\.hostname/)
  assert.doesNotMatch(settings, /url\.protocol === 'ws:' \? 'http:'/)
})

test('Chrome auth rule limits token to exact endpoint and socket-host tab', async () => {
  let rules
  const context = { chrome: { runtime: { id: 'extension-id' }, declarativeNetRequest: { async updateSessionRules (value) { rules = value } } } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../chrome-auth.js'), 'utf8'), context)
  const url = 'ws://127.0.0.1:4500/path?x=1'
  await context.xboostInstallAuth({ url, token: 'test-token', tabId: 42 })
  const rule = rules.addRules[0]
  const match = new RegExp(rule.condition.regexFilter)
  assert.ok(match.test(url))
  assert.equal(match.test(url + '2'), false)
  assert.equal(match.test('ws://127X0X0X1:4500/path?x=1'), false)
  assert.equal(rule.condition.tabIds[0], 42)
  assert.equal(rule.condition.resourceTypes[0], 'websocket')
})
