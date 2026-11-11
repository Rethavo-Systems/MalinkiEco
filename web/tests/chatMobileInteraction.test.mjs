import test from 'node:test'
import assert from 'node:assert/strict'
import { currentMobileMessage, isTouchChatInput, mobileMessagePermissions } from '../src/lib/chatMobileInteraction.ts'

test('touch switches gestures independently of viewport width while a mouse retains its context menu', () => {
  assert.equal(isTouchChatInput(false, 'touch'), true)
  assert.equal(isTouchChatInput(true, 'mouse'), false)
  assert.equal(isTouchChatInput(false), false)
  assert.equal(isTouchChatInput(true), true)
})

test('toolbar and details take current message ownership and discard stale account selections', () => {
  const selection = { messageId: 'message', viewerId: 'alice' }
  const original = { id: 'message', senderId: 'alice' }
  const changed = { ...original, senderId: 'bob' }
  assert.deepEqual(mobileMessagePermissions(currentMobileMessage([original], 'alice', selection), 'alice'), {
    canReply: true, canEdit: true, canDelete: true, canViewReaders: true,
  })
  assert.deepEqual(mobileMessagePermissions(currentMobileMessage([changed], 'alice', selection), 'alice'), {
    canReply: true, canEdit: false, canDelete: false, canViewReaders: false,
  })
  assert.equal(currentMobileMessage([original], 'bob', selection), null)
  assert.equal(currentMobileMessage([], 'alice', selection), null)
})
