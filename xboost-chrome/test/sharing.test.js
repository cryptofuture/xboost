'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../shared')
test('showcase invitations qualify without keywords but coercive bait stays excluded', () => {
  const settings = core.settingsFromProfile(core.PROFILES[0], core.DEFAULT_SETTINGS)
  const features = { ageMinutes: 5, replies: 1, views: 1000, handle: 'someone', isReply: false, isPromoted: false }
  for (const text of ['Drop what you building', 'Share your URL below', 'Drop what you’re building', 'Show your project', 'Share URL what you building']) {
    const result = core.scorePost({ ...features, text }, settings)
    assert.equal(result.excluded, false, text)
    assert.equal(result.invitation, true)
    assert.ok(result.score >= settings.threshold)
  }
  for (const text of ['Drop your project and follow me', 'Giveaway: share your URL', 'Drop your wallet below']) {
    assert.equal(core.scorePost({ ...features, text }, settings).excluded, true, text)
  }
})
