import test from 'node:test'
import assert from 'node:assert/strict'
import { balanceIndicator, pendingRequestCount, isPersonalEventVisible } from '../src/lib/navigationState.ts'
import { staffRecipients, notificationEmailTargets } from '../src/lib/notificationRecipients.ts'

const users = [
  { id:'plot3', email:'three@example.com', role:'USER', notificationSettings:{payments:true} },
  { id:'plot4', email:'four@example.com', role:'USER', notificationSettings:{payments:true} },
  { id:'multi', email:'multi@example.com', role:'USER', notificationSettings:{payments:true} },
  { id:'admin', email:'admin@example.com', role:'ADMIN', notificationSettings:{} },
  { id:'mod', email:'mod@example.com', role:'MODERATOR', notificationSettings:{} },
  { id:'tester', email:'tester@example.com', role:'TESTER', notificationSettings:{} },
]
test('payment colours distinguish debt, credit and settled account', () => {
  assert.equal(balanceIndicator(-5000).tone,'debt')
  assert.equal(balanceIndicator(1).tone,'credit')
  assert.equal(balanceIndicator(0).tone,'clear')
})
test('pending badge excludes archived requests and duplicates, never depends on opened tab', () => {
  assert.equal(pendingRequestCount([{id:'a',status:'PENDING'},{id:'a',status:'PENDING'},{id:'b',status:'CONFIRMED'},{id:'c',status:'REJECTED'}]),1)
})
test('personal events cannot leak from plot 3 to plot 4', () => {
  assert.equal(isPersonalEventVisible('plot3','plot4'),false)
  assert.equal(isPersonalEventVisible('plot3','plot3'),true)
  assert.equal(isPersonalEventVisible('','plot4'),true)
})
test('payment email has only exact account targets and multiple plots do not duplicate delivery', () => {
  assert.deepEqual(notificationEmailTargets(users,'payments',['plot3']),['three@example.com'])
  assert.deepEqual(notificationEmailTargets(users,'payments',['multi','multi']),['multi@example.com'])
  assert.deepEqual(notificationEmailTargets(users,'payments',[]),[])
})
test('staff requests exclude residents and testers; opt-out and exclusions are respected', () => {
  assert.deepEqual(staffRecipients(users),['admin','mod'])
  assert.deepEqual(notificationEmailTargets(users,'payments',['plot3'],['plot3']),[])
  assert.deepEqual(notificationEmailTargets([{...users[0], notificationSettings:{payments:false}}],'payments'),[])
})
