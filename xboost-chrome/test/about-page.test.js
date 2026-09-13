'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('about page links all bundled profiles and documented product websites', () => {
  const html = fs.readFileSync(require.resolve('../about.html'), 'utf8')
  for (const url of [
    'https://x.com/BitcoinWidget',
    'https://x.com/index_solana',
    'https://x.com/outruna_wallet',
    'https://x.com/IntentAIOps',
    'https://x.com/quellemor',
    'https://btcwid.com',
    'https://solanaindex.top',
    'https://outruna.top',
    'https://intentaiops.top'
  ]) assert.match(html, new RegExp(`href="${url.replace(/[.]/g, '\\.')}"`))
  assert.match(html, /liking posts you genuinely find useful/)
  assert.match(html, /id="version"/)
})

test('every project has its supplied logo and a short description', () => {
  const html = fs.readFileSync(require.resolve('../about.html'), 'utf8')
  const projects = [
    ['btcwid.png', 'A configurable crypto workspace'],
    ['solanaindex.png', 'exact historical Solana token balances'],
    ['outruna.png', 'open-source multi-chain EVM wallet[^<]*optional transaction 2FA and transaction simulation'],
    ['intentaiops.png', 'explicit operator approval before execution']
  ]
  for (const [icon, description] of projects) {
    assert.match(html, new RegExp(`src="icons/${icon}"`))
    assert.match(html, new RegExp(description))
  }
  assert.equal((html.match(/class="about-description"/g) || []).length, 4)
})

test('About popup action is last and hiding requires support confirmation', () => {
  const popup = fs.readFileSync(require.resolve('../popup.html'), 'utf8')
  const options = fs.readFileSync(require.resolve('../options.html'), 'utf8')
  const script = fs.readFileSync(require.resolve('../options.js'), 'utf8')
  assert.ok(popup.indexOf('id="about"') > popup.indexOf('id="settings"'))
  assert.match(options, /id="about-visibility"/)
  assert.match(options, /id="support-dialog"/)
  assert.match(options, /id="support-confirmation"/)
  assert.match(options, /Yes, I have supported the author/)
  assert.match(options, /id="confirm-hide-about" disabled/)
  assert.match(script, /disabled = !el\['support-confirmation'\]\.checked/)
  assert.match(script, /saveAboutVisibility\(true\)/)
  assert.match(script, /saveAboutVisibility\(false\)/)
  const css = fs.readFileSync(require.resolve('../ui.css'), 'utf8')
  assert.match(css, /\[hidden\] \{ display: none !important; \}/)
})

test('popup uses the short AI replies label', () => {
  const popup = fs.readFileSync(require.resolve('../popup.html'), 'utf8')
  assert.match(popup, /id="ai-replies">AI replies<\/button>/)
  assert.doesNotMatch(popup, /AI replies \/ automode/)
})
