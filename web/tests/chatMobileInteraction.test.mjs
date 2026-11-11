import test from 'node:test'
import assert from 'node:assert/strict'
import { currentMobileMessage, currentMobileMessages, isTouchChatInput, mobileMessagePermissions, updateMobileMessageGroup } from '../src/lib/chatMobileInteraction.ts'
import { chatSelectionCopyText } from '../src/lib/chatFormatting.ts'

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

test('mobile holds add a message once and tapping its control removes just that message', () => {
  const first = updateMobileMessageGroup(null, 'alice', 'first', true)
  const both = updateMobileMessageGroup(first, 'alice', 'second', true)
  assert.equal(updateMobileMessageGroup(both, 'alice', 'second', true), both)
  assert.deepEqual([...first.messageIds], ['first'])
  assert.deepEqual([...both.messageIds], ['first', 'second'])
  const remaining = updateMobileMessageGroup(both, 'alice', 'first', false)
  assert.deepEqual([...remaining.messageIds], ['second'])
  assert.equal(updateMobileMessageGroup(remaining, 'alice', 'second', false), null)
  assert.equal(updateMobileMessageGroup(both, 'bob', 'first', false), both)
})

test('copy takes current text and captions in chat order, including plain formatted text', () => {
  let selection = null
  for (const id of ['second', 'deleted', 'file', 'first']) {
    selection = updateMobileMessageGroup(selection, 'alice', id, true)
  }
  const messages = [
    { id: 'first', text: '**Первое _сообщение_**\nПродолжение' },
    { id: 'file', text: '' },
    { id: 'second', text: 'Подпись к фото' },
  ]
  assert.equal(chatSelectionCopyText(currentMobileMessages(messages, 'alice', selection)), 'Первое сообщение\nПродолжение\n\nПодпись к фото')
  assert.deepEqual(currentMobileMessages(messages, 'bob', selection), [])
  assert.equal(chatSelectionCopyText([{ text: '' }]), '')
})
