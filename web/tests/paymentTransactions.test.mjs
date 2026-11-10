import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { createStore } from './support/firestoreMemory.mjs'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'firebase/firestore') return next(new URL('./support/firestoreMemory.mjs', import.meta.url).href, context)
  if (['firebase/auth','firebase/database'].includes(specifier) || (specifier === './firebase' && context.parentURL?.includes('/src/lib/'))) {
    return next(new URL('./support/firebaseOffline.mjs', import.meta.url).href, context)
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return next(url.href, context)
  }
  return next(specifier, context)
} })
const { confirmPaymentRequest, rejectPaymentRequest, createPaymentRequest, ensurePlotAccounts, createEvent, setUserBalance, enqueueTargetedNotification } = await import('../src/lib/appApi.ts')
const reviewer = { id:'admin', fullName:'Administrator', role:'ADMIN' }
function seed() {
  const plots = Object.fromEntries(Array.from({length:35}, (_, i) => [`plots/plot-${String(i+1).padStart(2,'0')}`, {name:`Участок ${i+1}`, balance:0}]))
  return {
    ...plots, 'app_settings/community_funds':{amount:0},
    'users/payer':{plots:['Участок 3','Участок 4'], balance:0},
    'users/shared3':{plots:['Участок 3'], balance:0},
    'users/other4':{plots:['Участок 4'], balance:0},
    'payment_requests/a':{userId:'payer', userName:'Payer', plotIds:['Участок 3'], plotName:'Участок 3', amount:100, status:'PENDING'},
    'payment_requests/b':{userId:'payer', userName:'Payer', plotIds:['Участок 3'], plotName:'Участок 3', amount:200, status:'PENDING'},
  }
}
test('parallel approvals preserve both payments and all shared owner balances', async () => {
  const db = createStore(seed())
  assert.deepEqual(await Promise.all(['a','b'].map(id => confirmPaymentRequest(db, reviewer, id))), [true,true])
  assert.ok(db.retries > 0, 'test must force transaction contention')
  assert.equal(db.values.get('app_settings/community_funds').amount,300)
  for (const path of ['plots/plot-03','users/payer','users/shared3']) assert.equal(db.values.get(path).balance,300,path)
  assert.equal(db.values.get('users/other4').balance,0)
  assert.equal(db.values.get('events/payment-review-a').targetUserId,'payer')
  assert.equal([...db.values.keys()].filter(path => path.startsWith('audit_logs/')).length,2)
})
test('two reviewers can apply a request only once; approve versus reject has one winner', async () => {
  for (const reject of [false,true]) {
    const db = createStore(seed())
    const results = await Promise.all([confirmPaymentRequest(db,reviewer,'a'), reject ? rejectPaymentRequest(db,reviewer,'a','reason') : confirmPaymentRequest(db,reviewer,'a')])
    assert.equal(results.filter(Boolean).length,1)
    const confirmed = db.values.get('payment_requests/a').status === 'CONFIRMED'
    assert.equal(db.values.get('app_settings/community_funds').amount,confirmed ? 100 : 0)
    assert.equal([...db.values.keys()].filter(path => path.startsWith('events/')).length,1)
  }
})
test('audit failure rolls back payment, account and resident notification together', async () => {
  const db = createStore(seed()); db.failPath = 'audit_logs/'
  await assert.rejects(confirmPaymentRequest(db,reviewer,'a'),/commit failure/)
  assert.equal(db.values.get('payment_requests/a').status,'PENDING')
  assert.equal(db.values.get('app_settings/community_funds').amount,0)
  assert.equal(db.values.get('users/payer').balance,0)
  assert.equal(db.values.has('events/payment-review-a'),false)
})
test('legacy request uses its recorded plots after account ownership changes', async () => {
  const values = seed(); delete values['payment_requests/a'].plotIds
  values['users/payer'].plots = ['Участок 4']
  const db = createStore(values)
  await confirmPaymentRequest(db,reviewer,'a')
  assert.equal(db.values.get('plots/plot-03').balance,100)
  assert.equal(db.values.get('users/payer').balance,0)
  assert.equal(db.values.get('users/shared3').balance,100)
})
test('invalid amounts, empty purpose, changed ownership and closed charges produce no request', async () => {
  const db = createStore(seed())
  const payer = {id:'payer', fullName:'Payer',plots:['Участок 3','Участок 4']}
  for (const amount of [NaN,Infinity,-1,0,12.5]) await assert.rejects(createPaymentRequest(db,payer,amount,[],'payment'))
  await assert.rejects(createPaymentRequest(db,payer,100,[],' '))
  await assert.rejects(createPaymentRequest(db,payer,100,[],'payment',['Участок 9']))
  db.values.get('users/payer').plots = ['Участок 4']
  await assert.rejects(createPaymentRequest(db,payer,100,[],'payment',['Участок 3']))
  db.values.set('events/closed',{type:'CHARGE',isClosed:true})
  await assert.rejects(createPaymentRequest(db,payer,100,[{id:'closed',type:'CHARGE'}],'payment',['Участок 4']))
  assert.equal([...db.values.keys()].filter(path => path.startsWith('payment_requests/')).length,2)
})
test('parallel first-time migration does not overwrite a payment', async () => {
  const values = seed(); delete values['plots/plot-35']
  const db = createStore(values)
  await Promise.all([ensurePlotAccounts(db),confirmPaymentRequest(db,reviewer,'a')])
  assert.equal(db.values.get('plots/plot-03').balance,100)
  assert.equal(db.values.get('users/shared3').balance,100)
})
test('new charge and concurrent payment preserve both changes, including multi-plot accounts', async () => {
  const db = createStore(seed())
  await Promise.all([createEvent(db,reviewer,{type:'CHARGE',title:'Collection',message:'',amount:1000}),confirmPaymentRequest(db,reviewer,'a')])
  assert.equal(db.values.get('plots/plot-03').balance,-900)
  assert.equal(db.values.get('plots/plot-04').balance,-1000)
  assert.equal(db.values.get('users/payer').balance,-1900)
  assert.equal(db.values.get('users/shared3').balance,-900)
  assert.equal(db.values.get('app_settings/community_funds').amount,100)
})
test('failed journal write cannot leave a collection without its event', async () => {
  const db = createStore(seed()); db.failPath = 'audit_logs/'
  await assert.rejects(createEvent(db,reviewer,{type:'CHARGE',title:'Collection',message:'',amount:1000}),/commit failure/)
  assert.equal(db.values.get('plots/plot-03').balance,0)
  assert.equal(db.values.get('users/payer').balance,0)
  assert.equal([...db.values.keys()].some(path => path.startsWith('events/')),false)
})
test('manual correction updates shared accounts and rejects stale card balance', async () => {
  const db = createStore(seed())
  await setUserBalance(db,reviewer,{id:'payer',balance:0},501)
  assert.equal(db.values.get('users/payer').balance,501)
  assert.equal(db.values.get('users/shared3').balance,251)
  assert.equal(db.values.get('users/other4').balance,250)
  await assert.rejects(setUserBalance(db,reviewer,{id:'payer',balance:0},1),/Баланс уже изменился/)
})
test('failed realtime signal preserves the durable notification for worker fallback', async () => {
  const db = createStore()
  await enqueueTargetedNotification(db, {title:'Review',body:'Payment received',destination:'owners',category:'requests',targetUserIds:['admin']}, {creatorId:'admin',signalDb:{}})
  const jobs = [...db.values.entries()].filter(([path]) => path.startsWith('notification_jobs/'))
  assert.equal(jobs.length,1)
  assert.equal(jobs[0][1].status,'PENDING')
  assert.deepEqual(jobs[0][1].targetUserIds,['admin'])
})
test('collections and expenses reject malformed money before any writes', async () => {
  const db = createStore(seed())
  for (const type of ['CHARGE','EXPENSE']) for (const amount of [NaN,Infinity,12.5,-100,0]) {
    await assert.rejects(createEvent(db,reviewer,{type,title:'Collection',message:'',amount}),/целых рублях/)
  }
  assert.equal(db.values.get('plots/plot-03').balance,0)
  assert.equal([...db.values.keys()].some(path=>path.startsWith('events/')),false)
})
