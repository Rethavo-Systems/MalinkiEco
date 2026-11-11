import test from 'node:test'
import assert from 'node:assert/strict'
import {
  newestCreatedFirst, paymentRequestDescription, paymentRequestHistory,
  paymentRequestPlots, registrationRequestHistory,
} from '../src/lib/requestHistory.ts'

test('the payment archive uses review chronology rather than Firestore document-ID order', () => {
  const requests = [
    { id: 'a', status: 'CONFIRMED', createdAtClient: 20, reviewedAtClient: 30 },
    { id: 'b', status: 'REJECTED', createdAtClient: 10, reviewedAtClient: 80 },
    { id: 'z', status: 'CONFIRMED', createdAtClient: 50, reviewedAtClient: 60 },
  ]
  assert.deepEqual(paymentRequestHistory(requests).archive.map(item => item.id), ['b', 'z', 'a'])
  assert.deepEqual(requests.map(item => item.id), ['a', 'b', 'z'], 'sorting must not mutate loaded state')
})

test('legacy archive records fall back to creation time; active and unknown statuses never mix into it', () => {
  const requests = [
    { id: 'legacy', status: 'CONFIRMED', createdAtClient: 90 },
    { id: 'reviewed', status: 'REJECTED', createdAtClient: 10, reviewedAtClient: 80 },
    { id: 'pending-old', status: 'PENDING', createdAtClient: 100 },
    { id: 'pending-new', status: 'PENDING', createdAtClient: 120 },
    { id: 'unknown', status: 'UNSUPPORTED', createdAtClient: 200 },
  ]
  const history = paymentRequestHistory(requests)
  assert.deepEqual(history.active.map(item => item.id), ['pending-new', 'pending-old'])
  assert.deepEqual(history.archive.map(item => item.id), ['legacy', 'reviewed'])
})

test('registration history applies the same chronology and excludes unfinished verification', () => {
  const requests = [
    { id: 'approved', status: 'APPROVED', createdAtClient: 20, reviewedAtClient: 40 },
    { id: 'rejected', status: 'REJECTED', createdAtClient: 10, reviewedAtClient: 60 },
    { id: 'verifying', status: 'VERIFYING', createdAtClient: 80 },
    { id: 'pending', status: 'PENDING', createdAtClient: 70 },
  ]
  const history = registrationRequestHistory(requests)
  assert.deepEqual(history.archive.map(item => item.id), ['rejected', 'approved'])
  assert.deepEqual(history.active.map(item => item.id), ['pending'])
})

test('archive ties use creation time then identity, and invalid review dates use valid creation times', () => {
  const records = [
    { id: 'b', status: 'CONFIRMED', createdAtClient: 30, reviewedAtClient: 40 },
    { id: 'a', status: 'CONFIRMED', createdAtClient: 30, reviewedAtClient: 40 },
    { id: 'newer-request', status: 'CONFIRMED', createdAtClient: 35, reviewedAtClient: 40 },
    { id: 'bad-review', status: 'CONFIRMED', createdAtClient: 50, reviewedAtClient: NaN },
  ]
  assert.deepEqual(paymentRequestHistory(records).archive.map(item => item.id), ['bad-review', 'newer-request', 'a', 'b'])
})

test('the entered payment purpose remains distinct from linked charge titles', () => {
  assert.deepEqual(paymentRequestDescription({ purpose: '  За август и долг  ', eventTitle: 'Нужды КП' }), {
    purpose: 'За август и долг', linkedCharges: 'Нужды КП',
  })
  assert.deepEqual(paymentRequestDescription({ purpose: '', eventTitle: 'Нужды КП' }), {
    purpose: 'Без назначения', linkedCharges: 'Нужды КП',
  })
  assert.deepEqual(paymentRequestDescription({ purpose: 'Нужды КП', eventTitle: 'Нужды КП' }), {
    purpose: 'Нужды КП', linkedCharges: '',
  })
  assert.deepEqual(paymentRequestDescription({ purpose: '', eventTitle: '' }), {
    purpose: 'Без назначения', linkedCharges: '',
  })
})

test('historical payment plots come from the recorded request, including legacy comma-separated plots', () => {
  assert.equal(paymentRequestPlots({ plotIds: ['Участок 3', '4', 'Участок 3'], plotName: 'Участок 99' }), 'Участки 3, 4')
  assert.equal(paymentRequestPlots({ plotIds: [], plotName: 'Участок 23, 4' }), 'Участки 23, 4')
  assert.equal(paymentRequestPlots({ plotIds: [], plotName: '6' }), 'Участок 6')
  assert.equal(paymentRequestPlots({ plotIds: [], plotName: '' }), 'Участки не указаны')
})

test('charges and log records sort newest first with deterministic ties and missing dates last', () => {
  const records = [
    { id: 'older', createdAtClient: 10 }, { id: 'b', createdAtClient: 20 },
    { id: 'missing', createdAtClient: NaN }, { id: 'a', createdAtClient: 20 },
  ]
  assert.deepEqual(records.sort(newestCreatedFirst).map(item => item.id), ['a', 'b', 'older', 'missing'])
})
