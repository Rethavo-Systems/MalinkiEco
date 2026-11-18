import test from 'node:test'
import assert from 'node:assert/strict'
import { assertChatMessageLength, CHAT_MESSAGE_MAX_LENGTH } from '../src/lib/chatMessageValidation.ts'

test('chat text reports the 4000 character limit before a write', () => {
  assert.equal(CHAT_MESSAGE_MAX_LENGTH, 4000)
  assert.doesNotThrow(() => assertChatMessageLength('Я'.repeat(4000)))
  assert.throws(() => assertChatMessageLength('Я'.repeat(4001)), /4000 символов/)
  assert.doesNotThrow(() => assertChatMessageLength('👍'.repeat(2000)))
  assert.throws(() => assertChatMessageLength('👍'.repeat(2001)), /4000 символов/)
})
