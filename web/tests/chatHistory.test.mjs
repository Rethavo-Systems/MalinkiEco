import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeChatHistory } from '../src/lib/chatHistory.ts'

test('a pinned message survives outside the recent 120 messages and disappears when unpinned', () => {
  const recent = Array.from({ length: 120 }, (_, index) => ({ id: `recent-${index}`, createdAtClient: index + 100 }))
  const pin = { id: 'old-pin', createdAtClient: 1 }
  assert.equal(mergeChatHistory(recent, [pin]).length, 121)
  assert.equal(mergeChatHistory(recent, [pin])[0], pin)
  assert.deepEqual(mergeChatHistory(recent, []), recent)
})

test('overlapping subscriptions show one current message in chronological order', () => {
  const recent = [{ id: 'message', createdAtClient: 2, text: 'current' }]
  const pinned = [{ id: 'message', createdAtClient: 2, text: 'previous' }, { id: 'older', createdAtClient: 1, text: 'pin' }]
  assert.deepEqual(mergeChatHistory(recent, pinned).map(message => [message.id, message.text]), [['older', 'pin'], ['message', 'current']])
})
