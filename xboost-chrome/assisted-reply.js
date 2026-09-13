/* global browser, location, DataTransfer, ClipboardEvent */
'use strict'

// User-initiated composer assistance only. Never clicks Send, Like or Follow.
;(async function () {
  if (globalThis.__xboostAssistedReply) return
  globalThis.__xboostAssistedReply = true
  const response = await browser.runtime.sendMessage({ type: 'xboost:ai', action: 'handoff' })
  const item = response?.ok && response.data
  if (!item) return
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:390px;width:calc(100vw - 32px)'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = ':host{color-scheme:light}section{background:#fff;color:#15202b;border:2px solid #3269dd;border-radius:14px;padding:16px;font:14px/1.5 system-ui;box-shadow:0 8px 32px #0005}button{padding:9px;margin:6px 6px 0 0;cursor:pointer}textarea{box-sizing:border-box;width:100%;min-height:110px;font:inherit}p{margin:8px 0}'
  const card = document.createElement('section')
  const title = document.createElement('strong')
  title.textContent = `Xboost · Reply as @${item.expectedHandle}`
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'assertive')
  status.textContent = 'Switch to the intended X account if needed, then check and prepare. You must review and click Reply yourself.'
  const text = document.createElement('textarea')
  text.value = item.text
  text.setAttribute('aria-label', 'Reply draft')
  const prepare = document.createElement('button')
  prepare.textContent = 'Check account & fill reply'
  const copy = document.createElement('button')
  copy.textContent = 'Copy draft'
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.onclick = () => host.remove()
  copy.onclick = () => navigator.clipboard.writeText(text.value).then(() => { status.textContent = 'Copied. Check your X account before pasting and sending.' }).catch(() => { status.textContent = 'Copy unavailable. Select and copy the text above manually.' })
  function currentHandle () {
    const control = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
    const handles = [...new Set((control?.textContent || '').match(/@[a-zA-Z0-9_]{1,15}\b/g) || [])]
    return handles.length === 1 ? handles[0].slice(1) : null
  }
  function verify (checkPath = true) {
    if (!checkPath && location.pathname !== '/compose/post' && location.pathname !== '/compose/tweet' && !new RegExp(`^/[^/]+/status/${item.postId}/?$`).test(location.pathname)) throw new Error('X navigated away from the reply. Return to the source post and try again.')
    if (checkPath && !new RegExp(`^/[^/]+/status/${item.postId}/?$`).test(location.pathname)) throw new Error('Return to the original post before preparing this reply.')
    const handle = currentHandle()
    if (!handle) throw new Error('Cannot verify the active account. Expand X’s sidebar, or copy the draft and prepare it manually.')
    if (handle.toLowerCase() !== item.expectedHandle.toLowerCase()) throw new Error(`Active account is @${handle}. Switch to @${item.expectedHandle} in X, then try again.`)
    if (!text.value.trim()) throw new Error('Reply text is empty.')
  }
  prepare.onclick = async () => {
    prepare.disabled = true
    prepare.textContent = 'Preparing…'
    status.textContent = 'Checking the active X account…'
    status.style.color = ''
    try {
      verify()
      if (document.querySelector('[role="dialog"]')) throw new Error('Close the existing X dialog first; its contents will not be overwritten.')
      const post = [...document.querySelectorAll('article[data-testid="tweet"]')].find(article => {
        const link = article.querySelector('time')?.closest('a')
        return link && new URL(link.href).pathname.endsWith(`/status/${item.postId}`)
      })
      const reply = post?.querySelector('[data-testid="reply"]')
      if (!reply) throw new Error('Source post is not loaded. Wait for it to appear and try again.')
      reply.click()
      status.textContent = 'Opening X’s reply composer…'
      let editor
      for (let attempt = 0; attempt < 40; attempt++) {
        editor = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"][contenteditable="true"], [role="dialog"] [data-testid="tweetTextarea_0"] [contenteditable="true"]')
        if (editor && editor.getClientRects().length) break
        editor = null
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      if (!editor) throw new Error('Reply editor not found. Copy the draft and paste it manually.')
      // Opening a modal may change X's SPA URL to /compose/post. The source
      // was verified before clicking its Reply button; recheck account here.
      verify(false)
      if (editor.textContent.trim()) throw new Error('The reply editor already contains text. Copy/paste manually; nothing was overwritten.')
      status.textContent = 'Filling the reply editor…'
      const draft = text.value.trim()
      editor.click()
      editor.focus({ preventScroll: true })
      // Firefox needs the selection inside the editable node, not merely focus.
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand('insertText', false, draft)
      await new Promise(resolve => setTimeout(resolve, 300))
      if (!editor.isConnected) throw new Error('X replaced the composer. Check it before copying/pasting manually.')
      if (!editor.textContent.trim()) {
        // Give X's editor its normal paste event instead of mutating textContent,
        // which can look filled without updating React's actual draft state.
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/plain', draft)
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true, composed: true }))
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      if (!editor.isConnected || editor.textContent.trim() !== draft) throw new Error('X did not retain the draft. Click Copy draft, focus X’s reply field, and paste with Ctrl+V (Cmd+V on Mac). Nothing was sent.')
      verify(false)
      const send = editor.closest('[role="dialog"]')?.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
      if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') throw new Error('Text is visible, but X has not enabled Reply. Check length/account and paste manually if necessary. Nothing was sent.')
      status.textContent = `Prepared for @${item.expectedHandle}. Verify the reply target, text and account in X, then click Reply yourself. Nothing has been sent.`
    } catch (error) {
      status.textContent = `Could not prepare: ${error.message}`
      status.style.color = '#b42318'
    } finally { prepare.disabled = false; prepare.textContent = 'Check account & fill reply' }
  }
  card.append(title, status, text, prepare, copy, close)
  shadow.append(style, card)
  document.documentElement.append(host)
})().catch(() => {})
