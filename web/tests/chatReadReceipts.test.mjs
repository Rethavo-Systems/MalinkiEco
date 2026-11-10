import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedOwnChatMessage } from '../src/lib/chatReadReceipts.ts'

const messages = [
  { id: 'mine', senderId: 'author', text: 'My message' },
  { id: 'foreign', senderId: 'neighbor', text: 'Another message' },
]

test('readers are available only for a message authored by the current viewer', () => {
  assert.equal(selectedOwnChatMessage(messages, 'author', { messageId: 'mine', viewerId: 'author' }), messages[0])
  assert.equal(selectedOwnChatMessage(messages, 'author', { messageId: 'foreign', viewerId: 'author' }), null)
  assert.equal(selectedOwnChatMessage(messages, '', { messageId: 'mine', viewerId: '' }), null)
})

test('an open selection cannot survive a change of account, even when the next account authored the message', () => {
  assert.equal(selectedOwnChatMessage(messages, 'neighbor', { messageId: 'foreign', viewerId: 'author' }), null)
  assert.equal(selectedOwnChatMessage(messages, 'neighbor', { messageId: 'mine', viewerId: 'author' }), null)
})

test('removed messages and changed authors invalidate an old readers selection', () => {
  const selection = { messageId: 'mine', viewerId: 'author' }
  assert.equal(selectedOwnChatMessage(messages.slice(1), 'author', selection), null)
  assert.equal(selectedOwnChatMessage([{ ...messages[0], senderId: 'neighbor' }], 'author', selection), null)
})

test('readers use the current message instead of a stale menu snapshot', () => {
  const updated = { ...messages[0], text: 'Edited message', createdAtClient: 123 }
  assert.equal(selectedOwnChatMessage([updated], 'author', { messageId: 'mine', viewerId: 'author' }), updated)
  assert.equal(selectedOwnChatMessage(messages, 'author', null), null)
})
