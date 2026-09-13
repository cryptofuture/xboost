'use strict'

globalThis.XboostDialog = (() => {
  let activeResolve = null
  let dialog
  let title
  let message
  let confirmButton

  function finish (confirmed) {
    if (!activeResolve) return
    const resolve = activeResolve
    activeResolve = null
    dialog.close()
    resolve(confirmed)
  }

  function create () {
    dialog = document.createElement('dialog')
    dialog.className = 'support-dialog confirm-dialog'
    dialog.setAttribute('aria-labelledby', 'xboost-confirm-title')
    const content = document.createElement('div')
    content.className = 'support-dialog-content'
    title = document.createElement('h2')
    title.id = 'xboost-confirm-title'
    message = document.createElement('p')
    const actions = document.createElement('div')
    actions.className = 'actions dialog-actions'
    confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'button'
    cancelButton.textContent = 'Cancel'
    confirmButton.onclick = () => finish(true)
    cancelButton.onclick = () => finish(false)
    dialog.addEventListener('cancel', event => {
      event.preventDefault()
      finish(false)
    })
    actions.append(confirmButton, cancelButton)
    content.append(title, message, actions)
    dialog.append(content)
    document.body.append(dialog)
  }

  function confirm ({ title: heading, message: copy, confirmLabel = 'Confirm', danger = false }) {
    if (!dialog) create()
    if (activeResolve) return Promise.resolve(false)
    title.textContent = heading
    message.textContent = copy
    confirmButton.textContent = confirmLabel
    confirmButton.className = danger ? 'button danger' : 'button primary'
    dialog.showModal()
    return new Promise(resolve => { activeResolve = resolve })
  }

  return Object.freeze({ confirm })
})()
