/* global WebSocket */
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const counts = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (!counts.length) counts.push(1000, 10000, 50000)
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function endpoint (port, url) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = targets.find(item => item.url === url)
      if (target) return target.webSocketDebuggerUrl
    } catch {}
    await wait(100)
  }
  throw new Error('Chrome DevTools target did not start')
}

function evaluate (socketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl)
    const timer = setTimeout(() => { socket.close(); reject(new Error('Browser benchmark timed out')) }, 10 * 60 * 1000)
    socket.onerror = () => reject(new Error('Cannot connect to Chrome DevTools'))
    socket.onopen = () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: 'new Promise(resolve => { const timer = setInterval(() => { const value = document.getElementById("result")?.textContent; if (value && value !== "running") { clearInterval(timer); resolve(value) } }, 25) })',
        awaitPromise: true,
        returnByValue: true
      }
    }))
    socket.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
      else resolve(JSON.parse(message.result.result.value))
    }
  })
}

async function run (count, index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xboost-browser-benchmark-'))
  const port = 9400 + index
  const base = pathToFileURL(path.join(__dirname, 'browser.html')).href
  const url = base + '?count=' + count
  const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, url], { stdio: 'ignore' })
  try {
    return await evaluate(await endpoint(port, url))
  } finally {
    chrome.kill('SIGTERM')
    await new Promise(resolve => chrome.once('exit', resolve))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

;(async () => {
  const results = []
  for (const [index, count] of counts.entries()) results.push(await run(count, index))
  console.log(JSON.stringify({ method: 'Headless Chrome with real browser IndexedDB', results }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
