'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')

function environment (savedTheme) {
  let changed
  let stored = { hideAbout: false, ...(savedTheme ? { theme: savedTheme } : {}) }
  const documentElement = {
    dataset: {},
    style: {},
    classList: { remove () {} }
  }
  const context = {
    document: { documentElement },
    browser: {
      storage: {
        local: {
          async get () { return { 'xboost:ui': stored } },
          async set (value) { stored = value['xboost:ui'] }
        },
        onChanged: { addListener (listener) { changed = listener } }
      }
    },
    setTimeout,
    clearTimeout
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(root, 'theme.js'), 'utf8'), context)
  return { context, documentElement, stored: () => stored, changed: (...args) => changed(...args) }
}

test('Arctic Daylight is default and Ocean Signal persists globally', async () => {
  const env = environment()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(env.documentElement.dataset.theme, 'light')
  assert.equal(env.context.XboostTheme.normalize('unknown'), 'light')

  await env.context.XboostTheme.save('dark')
  assert.equal(env.documentElement.dataset.theme, 'dark')
  assert.equal(env.stored().hideAbout, false)
  assert.equal(env.stored().theme, 'dark')

  env.changed({ 'xboost:ui': { newValue: { theme: 'light' } } }, 'local')
  assert.equal(env.documentElement.dataset.theme, 'light')
})

test('every extension UI loads the theme before its stylesheet', () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith('.html') && fs.readFileSync(path.join(root, name), 'utf8').includes('ui.css'))
  assert.ok(pages.length >= 8)
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8')
    assert.match(html, /<html lang="en" class="theme-loading">/)
    assert.ok(html.indexOf('theme.js') < html.indexOf('ui.css'), `${page} must load theme.js before ui.css`)
  }
})

test('settings exposes the dark theme switch and both palettes', () => {
  const options = fs.readFileSync(path.join(root, 'options.html'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'ui.css'), 'utf8')
  assert.match(options, /id="dark-theme"/)
  assert.match(options, /Arctic Daylight/)
  assert.match(options, /Ocean Signal/)
  assert.match(css, /:root \{[\s\S]*--bg: #f5f8fc;/)
  assert.match(css, /:root\[data-theme='dark'\] \{[\s\S]*--bg: #080d18;/)
})
