import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { createStore } from './support/firestoreMemory.mjs'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'firebase/firestore') return next(new URL('./support/firestoreMemory.mjs', import.meta.url).href, context)
  if (['firebase/auth', 'firebase/database'].includes(specifier) || (specifier === './firebase' && context.parentURL?.includes('/src/lib/'))) {
    return next(new URL('./support/firebaseOffline.mjs', import.meta.url).href, context)
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return next(url.href, context)
  }
  return next(specifier, context)
} })

const { approveRegistrationRequest, rejectRegistrationRequest, deleteUserRecord, createEvent } = await import('../src/lib/appApi.ts')
const reviewer = { id: 'moderator', fullName: 'Moderator', role: 'MODERATOR' }
const staleCard = { id: 'resident', requestType: 'PROFILE_UPDATE', proposedFullName: 'Old proposed name', proposedPhone: '89990000000', plots: ['3'] }
const request = {
  requestType: 'PROFILE_UPDATE', status: 'PENDING', currentFullName: 'Resident', fullName: 'Latest proposed name',
  proposedFullName: 'Latest proposed name', proposedPhone: '89160000000', phone: '89160000000', plots: ['3'],
}
const profile = { fullName: 'Resident', phone: '89161111111', plots: ['3'], role: 'USER', balance: -1000 }
const seed = () => ({ 'users/resident': profile, 'registration_requests/resident': request })

test('profile approval uses the live request and keeps role, balance and plots intact', async () => {
  const db = createStore(seed())
  assert.equal(await approveRegistrationRequest(db, reviewer, staleCard), true)
  assert.deepEqual(db.values.get('users/resident'), { ...profile, fullName: request.proposedFullName, phone: request.proposedPhone })
  assert.equal(db.values.get('registration_requests/resident').status, 'APPROVED')
  assert.equal(db.values.get('registration_requests/resident').reviewedById, reviewer.id)
  assert.equal([...db.values.keys()].filter(path => path.startsWith('audit_logs/')).length, 1)
})

test('parallel profile reviewers apply one decision and create one audit record', async () => {
  for (const reject of [false, true]) {
    const db = createStore(seed())
    const decisions = await Promise.all([
      approveRegistrationRequest(db, reviewer, staleCard),
      reject ? rejectRegistrationRequest(db, reviewer, staleCard, 'Reason') : approveRegistrationRequest(db, reviewer, staleCard),
    ])
    assert.equal(decisions.filter(Boolean).length, 1)
    assert.equal([...db.values.keys()].filter(path => path.startsWith('audit_logs/')).length, 1)
    const approved = db.values.get('registration_requests/resident').status === 'APPROVED'
    assert.equal(db.values.get('users/resident').fullName, approved ? request.proposedFullName : profile.fullName)
  }
})

test('failed profile audit rolls back the request and profile together', async () => {
  const db = createStore(seed())
  db.failPath = 'audit_logs/'
  await assert.rejects(approveRegistrationRequest(db, reviewer, staleCard), /commit failure/)
  assert.equal(db.values.get('registration_requests/resident').status, 'PENDING')
  assert.deepEqual(db.values.get('users/resident'), profile)
})

test('a stale registration rejection never changes an approved resident or queues auth deletion', async () => {
  const db = createStore({ ...seed(), 'registration_requests/resident': { requestType: 'REGISTRATION', status: 'APPROVED' } })
  assert.equal(await rejectRegistrationRequest(db, reviewer, { id: 'resident', requestType: 'REGISTRATION' }, 'Reason'), false)
  assert.equal(db.values.get('registration_requests/resident').status, 'APPROVED')
  assert.deepEqual(db.values.get('users/resident'), profile)
  assert.equal([...db.values.keys()].some(path => path.startsWith('notification_jobs/')), false)
})

test('changed request type and existing registration account stop review before writes', async () => {
  const db = createStore(seed())
  await assert.rejects(approveRegistrationRequest(db, reviewer, { id: 'resident', requestType: 'REGISTRATION' }), /Заявка изменилась/)
  const registration = createStore({ ...seed(), 'registration_requests/resident': { requestType: 'REGISTRATION', status: 'PENDING' } })
  await assert.rejects(rejectRegistrationRequest(registration, reviewer, { id: 'resident', requestType: 'REGISTRATION' }, 'Reason'), /уже зарегистрирован/)
  assert.deepEqual(registration.values.get('users/resident'), profile)
})

test('registration approval reads current plots, fields and balances from its transaction', async () => {
  const plots = Object.fromEntries(Array.from({ length: 35 }, (_, index) => [
    `plots/plot-${String(index + 1).padStart(2, '0')}`, { name: `Участок ${index + 1}`, balance: (index + 1) * -1000 },
  ]))
  const db = createStore({
    ...plots,
    'registration_requests/resident': { requestType: 'REGISTRATION', status: 'PENDING', fullName: 'Latest name', authEmail: 'resident@example.test', plots: ['5', '6'] },
  })
  assert.equal(await approveRegistrationRequest(db, reviewer, { id: 'resident', requestType: 'REGISTRATION', plots: ['3'], fullName: 'Old name' }), true)
  const user = db.values.get('users/resident')
  assert.deepEqual(user.plots, ['5', '6'])
  assert.equal(user.balance, -11000)
  assert.equal(user.fullName, 'Latest name')
  assert.equal(user.role, 'USER')
})

test('registration racing a new collection leaves the new resident in sync with the plot balance', async () => {
  const plots = Object.fromEntries(Array.from({ length: 35 }, (_, index) => [
    `plots/plot-${String(index + 1).padStart(2, '0')}`, { name: `Участок ${index + 1}`, balance: 0 },
  ]))
  const db = createStore({
    ...plots,
    'registration_requests/resident': { requestType: 'REGISTRATION', status: 'PENDING', fullName: 'Resident', authEmail: 'resident@example.test', plots: ['5'] },
  })
  await Promise.all([
    approveRegistrationRequest(db, reviewer, { id: 'resident', requestType: 'REGISTRATION' }),
    createEvent(db, reviewer, { type: 'CHARGE', title: 'Collection', message: '', amount: 1000 }),
  ])
  assert.ok(db.retries > 0, 'registration plot metadata must conflict with the concurrent financial update')
  assert.equal(db.values.get('users/resident').balance, -1000)
  assert.equal(db.values.get('users/resident').balance, db.values.get('plots/plot-05').balance)
})

test('registration rejection and its auth-cleanup job commit together', async () => {
  const db = createStore({ 'registration_requests/resident': { requestType: 'REGISTRATION', status: 'PENDING', fullName: 'Resident', plots: ['3'] } })
  assert.equal(await rejectRegistrationRequest(db, reviewer, { id: 'resident', requestType: 'REGISTRATION' }, 'Reason'), true)
  const jobs = [...db.values.entries()].filter(([path]) => path.startsWith('notification_jobs/'))
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0][1].authDeleteUserId, 'resident')
  assert.equal(jobs[0][1].sendEmail, false)
  assert.equal(jobs[0][1].sendPush, false)
  assert.equal(db.values.get('registration_requests/resident').status, 'REJECTED')
})

test('account deletion cannot partially remove a profile if request or audit deletion fails', async () => {
  const admin = { id: 'admin', fullName: 'Admin', role: 'ADMIN' }
  for (const path of ['registration_requests/', 'audit_logs/', 'notification_jobs/']) {
    const db = createStore(seed())
    db.failPath = path
    await assert.rejects(deleteUserRecord(db, admin, { id: 'resident', fullName: profile.fullName, plots: profile.plots }), /commit failure/)
    assert.deepEqual(db.values.get('users/resident'), profile)
    assert.equal(db.values.get('registration_requests/resident').status, 'PENDING')
    assert.equal([...db.values.keys()].some(path => path.startsWith('notification_jobs/')), false)
  }
})

test('administrator deletion atomically removes profile/request and queues cleanup without a notification', async () => {
  const db = createStore(seed())
  await deleteUserRecord(db, { id: 'admin', fullName: 'Admin', role: 'ADMIN' }, { id: 'resident', fullName: profile.fullName, plots: profile.plots })
  assert.equal(db.values.has('users/resident'), false)
  assert.equal(db.values.has('registration_requests/resident'), false)
  const job = [...db.values.entries()].find(([path]) => path.startsWith('notification_jobs/'))[1]
  assert.equal(job.authDeleteUserId, 'resident')
  assert.equal(job.cleanupWebPushUserId, 'resident')
  assert.equal(job.sendPush, false)
  assert.equal(job.sendEmail, false)
  assert.equal([...db.values.keys()].filter(path => path.startsWith('audit_logs/')).length, 1)
})
