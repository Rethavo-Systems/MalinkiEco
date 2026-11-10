import test from 'node:test'
import assert from 'node:assert/strict'
import { reservedChargeIds, parsePaymentRubles } from '../src/lib/paymentSelection.ts'

test('payment for plot 3 does not hide a charge when paying for plot 4', () => {
  const requests = [{status:'PENDING', plots:['Участок 3'], eventIds:['charge']}]
  assert.deepEqual([...reservedChargeIds(['Участок 4'], requests)], [])
  assert.deepEqual([...reservedChargeIds(['Участок 3'], requests)], ['charge'])
  assert.deepEqual([...reservedChargeIds(['Участок 3','Участок 4'], requests)], ['charge'])
})
test('rejection releases the charge; confirmation and another payer on same plot reserve it', () => {
  assert.equal(reservedChargeIds(['Участок 3'], [{status:'REJECTED',plots:['Участок 3'],eventIds:['a']}]).size, 0)
  assert.equal(reservedChargeIds(['Участок 3'], [{status:'CONFIRMED',plots:['Участок 3'],eventIds:['a','a']}]).size, 1)
  assert.equal(reservedChargeIds([], [{status:'PENDING',plots:['Участок 3'],eventIds:['a']}]).size, 0)
})
test('amount input never silently changes decimal, negative or malformed amounts', () => {
  for (const value of ['12.50','12,50','-500','1e3','500 ₽','','0','9007199254740992']) assert.equal(parsePaymentRubles(value), null, value)
  assert.equal(parsePaymentRubles('1 500'),1500)
  assert.equal(parsePaymentRubles('2\u00a0500'),2500)
})
