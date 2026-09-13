'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function environment () {
  const listeners = new Map()
  const body = { children: [], append (node) { this.children.push(node) } }
  const document = {
    body,
    createElement (tagName) {
      return {
        tagName,
        children: [],
        className: '',
        textContent: '',
        open: false,
        append (...nodes) { this.children.push(...nodes) },
        setAttribute () {},
        addEventListener (type, listener) { listeners.set(this, { ...(listeners.get(this) || {}), [type]: listener }) },
        showModal () { this.open = true },
        close () { this.open = false }
      }
    }
  }
  const context = { document }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(require.resolve('../confirm-dialog.js'), 'utf8'), context)
  return { api: context.XboostDialog, body, listeners }
}

test('shared confirmation dialog resolves confirm and cancel actions', async () => {
  const env = environment()
  const confirmed = env.api.confirm({ title: 'Delete profile?', message: 'This cannot be restored.', confirmLabel: 'Delete profile', danger: true })
  const dialog = env.body.children[0]
  const content = dialog.children[0]
  const actions = content.children[2]
  const confirmButton = actions.children[0]
  assert.equal(dialog.open, true)
  assert.equal(confirmButton.className, 'button danger')
  confirmButton.onclick()
  assert.equal(await confirmed, true)
  assert.equal(dialog.open, false)

  const cancelled = env.api.confirm({ title: 'Discard?', message: 'Unsaved changes.' })
  const event = { prevented: false, preventDefault () { this.prevented = true } }
  env.listeners.get(dialog).cancel(event)
  assert.equal(await cancelled, false)
  assert.equal(event.prevented, true)
})

test('profile and reply confirmations use the shared themed component', () => {
  const profiles = fs.readFileSync(require.resolve('../profiles.js'), 'utf8')
  const ai = fs.readFileSync(require.resolve('../ai.js'), 'utf8')
  const discovery = fs.readFileSync(require.resolve('../discovery-ui.js'), 'utf8')
  const selection = fs.readFileSync(require.resolve('../selection.js'), 'utf8')
  assert.doesNotMatch(profiles, /window\.confirm/)
  assert.doesNotMatch(ai, /window\.confirm/)
  assert.match(profiles, /Delete profile', true/)
  assert.match(ai, /dialogs\.confirm/)
  assert.match(discovery, /Force stop and start discovery over\?/)
  assert.match(discovery, /el\('session-restart'\)\.disabled = !catalogReady/)
  assert.match(selection, /dialogStyle\(data\['xboost:ui'\]\?\.theme === 'dark'\)/)
})
