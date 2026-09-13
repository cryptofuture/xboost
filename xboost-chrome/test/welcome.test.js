'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('welcome explains the manual workflow and opens profile creation directly', () => {
  const html = fs.readFileSync(path.join(root, 'welcome.html'), 'utf8')
  const script = fs.readFileSync(path.join(root, 'welcome.js'), 'utf8')

  assert.match(html, /How to use Xboost/)
  assert.match(html, /does not automatically publish, like, follow or switch your X account/)
  assert.match(html, /id="create-profile"/)
  assert.match(script, /profiles\.html\?create=1&activate=1&return=welcome/)
  assert.match(script, /browser\.storage\.onChanged\.addListener/)
})

test('profile editor supports direct create mode and activates a welcome-created profile', () => {
  const script = fs.readFileSync(path.join(root, 'profiles.js'), 'utf8')
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8')

  assert.match(script, /get\('create'\) === '1'/)
  assert.match(script, /get\('activate'\) === '1'/)
  assert.match(script, /get\('return'\) === 'welcome'/)
  assert.match(script, /core\.switchProfile\(response\.settings\.createdProfileId\)/)
  assert.match(script, /window\.location\.assign\(browser\.runtime\.getURL\('welcome\.html'\)\)/)
  assert.match(script, /el\('back-welcome'\)\.onclick = \(\) => \{ goToWelcome\(\)/)
  assert.match(background, /url\.startsWith\(profileEditorURL \+ '\?'\)/)
  assert.match(background, /!isProfileEditor\(sender\)/)
})

test('Codex settings show cross-platform token and app-server commands', () => {
  const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8')

  assert.match(html, /openssl rand -hex 32/)
  assert.match(html, /--ws-token-file \.\/xboost-token/)
  assert.match(html, /Linux or macOS/)
  assert.match(html, /Windows PowerShell/)
  assert.match(html, /codex app-server --listen ws:\/\/0\.0\.0\.0:4500/)
  assert.match(html, /--ws-auth capability-token/)
  assert.match(html, /--ws-token-file/)
})
