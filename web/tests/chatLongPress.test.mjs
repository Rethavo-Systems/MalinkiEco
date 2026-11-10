import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatLongPress } from '../src/lib/chatLongPress.ts'

function gesture() {
  let now = 0
  let timer = null
  const control = new ChatLongPress({
    now: () => now,
    setTimer: callback => { timer = callback; return 1 },
    clearTimer: () => { timer = null },
  })
  return { control, elapse: amount => { now += amount }, hold: () => { now += 420; timer?.() } }
}

test('releasing a held photo suppresses its synthetic click instead of opening or retrying it', () => {
  const { control, hold } = gesture()
  let opens = 0
  control.start({ x: 20, y: 30 }, () => opens++)
  hold()
  assert.equal(opens, 1)
  assert.equal(control.finish(), true)
  assert.equal(control.consumeClick(), true)
  assert.equal(control.consumeClick(), false)
})

test('a small finger movement keeps a hold, while scrolling cancels it', () => {
  const { control, hold } = gesture()
  let opens = 0
  control.start({ x: 20, y: 30 }, () => opens++)
  control.move({ x: 24, y: 32 })
  hold()
  assert.equal(opens, 1)
  control.finish()
  control.start({ x: 20, y: 30 }, () => opens++)
  control.move({ x: 20, y: 60 })
  hold()
  assert.equal(opens, 1)
  assert.equal(control.finish(), false)
})

test('touch cancellation after opening a menu still suppresses the browser click', () => {
  const { control, hold } = gesture()
  control.start({ x: 0, y: 0 }, () => {})
  hold()
  control.cancel()
  assert.equal(control.consumeClick(), true)
})

test('a quick tap and later intentional taps are not suppressed', () => {
  const { control, hold, elapse } = gesture()
  control.start({ x: 0, y: 0 }, () => {})
  assert.equal(control.finish(), false)
  assert.equal(control.consumeClick(), false)
  control.start({ x: 0, y: 0 }, () => {})
  hold()
  control.finish()
  elapse(801)
  assert.equal(control.consumeClick(), false)
})
