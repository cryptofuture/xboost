/* global browser */
'use strict'

document.getElementById('version').textContent = browser.runtime.getManifest().version
