import test from 'node:test'
import assert from 'node:assert/strict'
import { canReadVisibleContent } from '../src/lib/readVisibility.ts'

test('unread records survive hidden windows, loss of focus and covering dialogs', () => {
  const original = globalThis.document
  try {
    for (const state of [
      {hidden:false,focused:true,obscured:false,expected:true},
      {hidden:true,focused:true,obscured:false,expected:false},
      {hidden:false,focused:false,obscured:false,expected:false},
      {hidden:false,focused:true,obscured:true,expected:false},
    ]) {
      globalThis.document = { hidden:state.hidden, hasFocus:()=>state.focused, querySelector:()=>state.obscured ? {} : null }
      assert.equal(canReadVisibleContent(), state.expected,JSON.stringify(state))
    }
  } finally { if (original === undefined) delete globalThis.document; else globalThis.document = original }
})
