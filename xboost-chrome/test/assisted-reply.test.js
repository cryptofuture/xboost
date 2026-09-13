'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')

test('composer route changes do not block filling; selection is set and send is never clicked', async () => {
  const nodes = []
  let selectionSet = false
  let modal = false
  let sendClicked = false
  const location = { pathname: '/someone/status/123' }
  const send = { disabled: false, getAttribute: () => null, click () { sendClicked = true } }
  const editor = {
    textContent: '',
    isConnected: true,
    getClientRects: () => [1],
    click () {},
    focus () {},
    closest: () => ({ querySelector: () => send })
  }
  const document = {
    createElement (tag) {
      const node = { tag, style: {}, setAttribute () {}, append () {}, remove () {}, attachShadow: () => ({ append () {} }) }
      nodes.push(node)
      return node
    },
    documentElement: { append () {} },
    createRange: () => ({ selectNodeContents () {}, collapse () {} }),
    querySelector (selector) {
      if (selector.includes('SideNav')) return { textContent: '@BitcoinWidget' }
      if (selector === '[role="dialog"]') return modal ? {} : null
      if (selector.includes('contenteditable')) return modal ? editor : null
      return null
    },
    querySelectorAll: () => [{
      querySelector (selector) {
        if (selector === 'time') return { closest: () => ({ href: 'https://x.com/someone/status/123' }) }
        return { click () { modal = true; location.pathname = '/compose/post' } }
      }
    }],
    execCommand (command, ui, text) {
      assert.equal(command, 'insertText')
      assert.equal(selectionSet, true)
      editor.textContent = text
      return true
    }
  }
  await vm.runInNewContext(fs.readFileSync(require.resolve('../assisted-reply'), 'utf8'), {
    browser: { runtime: { async sendMessage () { return { ok: true, data: { postId: '123', expectedHandle: 'BitcoinWidget', text: 'Useful reply' } } } } },
    document,
    location,
    URL,
    window: { getSelection: () => ({ removeAllRanges () {}, addRange () { selectionSet = true } }) },
    navigator: {},
    setTimeout: fn => { fn() }
  })
  await nodes.find(node => node.tag === 'button' && node.textContent === 'Check account & fill reply').onclick()
  assert.equal(editor.textContent, 'Useful reply')
  assert.equal(sendClicked, false)
  assert.match(nodes.find(node => node.tag === 'p').textContent, /Nothing has been sent/)
})
