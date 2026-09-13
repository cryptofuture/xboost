/* global browser */
'use strict'

globalThis.XboostTheme = (() => {
  const KEY = 'xboost:ui'
  const DARK = 'dark'
  const LIGHT = 'light'

  function normalize (value) { return value === DARK ? DARK : LIGHT }

  function apply (value) {
    const theme = normalize(value)
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    return theme
  }

  async function load () {
    const stored = (await browser.storage.local.get(KEY))[KEY]
    return apply(stored?.theme)
  }

  async function save (value) {
    const stored = (await browser.storage.local.get(KEY))[KEY] || {}
    const theme = normalize(value)
    await browser.storage.local.set({ [KEY]: { ...stored, theme } })
    apply(theme)
    return theme
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) apply(changes[KEY].newValue?.theme)
  })

  const reveal = () => document.documentElement.classList.remove('theme-loading')
  const fallback = globalThis.setTimeout(reveal, 250)
  load().catch(() => apply(LIGHT)).finally(() => {
    globalThis.clearTimeout(fallback)
    reveal()
  })

  return Object.freeze({ KEY, DARK, LIGHT, apply, load, save, normalize })
})()
