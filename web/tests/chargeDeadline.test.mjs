import test from 'node:test'
import assert from 'node:assert/strict'
import { isChargeClosed, validateChargeDeadline } from '../src/lib/chargeDeadline.ts'

test('charges without deadline remain open', () => {
  assert.equal(isChargeClosed({ type: 'CHARGE', isClosed: false }, 1000), false)
  assert.equal(isChargeClosed({ type: 'CHARGE', isClosed: false, closesAtClient: 0 }, 1000), false)
})
test('deadline closes a charge at its exact boundary', () => {
  const charge = { type: 'CHARGE', isClosed: false, closesAtClient: 1000 }
  assert.equal(isChargeClosed(charge, 999), false)
  assert.equal(isChargeClosed(charge, 1000), true)
  assert.equal(isChargeClosed(charge, 1001), true)
})
test('manual closure is preserved and unrelated events are not expired', () => {
  assert.equal(isChargeClosed({ type: 'CHARGE', isClosed: true }, 1000), true)
  assert.equal(isChargeClosed({ type: 'POLL', isClosed: false, closesAtClient: 1 }, 1000), false)
})
test('creation rejects invalid or past dates and accepts unlimited or future', () => {
  for (const value of [NaN, Infinity, -1, 999, 1000]) assert.throws(() => validateChargeDeadline(value, 1000))
  assert.equal(validateChargeDeadline(0, 1000), 0)
  assert.equal(validateChargeDeadline(1001, 1000), 1001)
})
