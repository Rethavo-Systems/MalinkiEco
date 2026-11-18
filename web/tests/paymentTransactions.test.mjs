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
const { confirmPaymentRequest, rejectPaymentRequest, createPaymentRequest, ensurePlotAccounts, createEvent, setUserBalance, enqueueTargetedNotification, approveRegistrationRequest } = await import('../src/lib/appApi.ts')
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

test('payment request uses exact server ownership values required by Firestore rules', async () => {
  for (const storedPlots of [['3', '4'], ['Участок 3', 'Участок 4'], [' 3 ', 'участок 4']]) {
    const db = createStore({ 'users/payer': { plots: storedPlots }, 'events/charge': { type: 'CHARGE', isClosed: false } })
    const payer = { id: 'payer', fullName: 'Payer', plots: ['Участок 3', 'Участок 4'], plotName: 'Участок 3, Участок 4' }
    await createPaymentRequest(db, payer, 1000, [{ id: 'charge', type: 'CHARGE', title: 'Сбор' }], 'За ноябрь', ['Участок 4'])
    const requests = [...db.values.entries()].filter(([path]) => path.startsWith('payment_requests/'))
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0][1].plotIds, [storedPlots[1]])
    assert.equal(requests[0][1].plotName, 'Участок 4')
    assert.equal(requests[0][1].amount, 1000)
    assert.equal(requests[0][1].status, 'PENDING')
    assert.equal(requests[0][1].purpose, 'За ноябрь')
    assert.deepEqual(db.values.get('users/payer').plots, storedPlots)
  }
})

test('multi-plot request preserves stored IDs and confirmation credits only its selected plots', async () => {
  const values = seed()
  values['users/payer'].plots = ['3', '4']
  values['users/shared3'].plots = ['3']
  values['users/other4'].plots = ['4']
  const db = createStore(values)
  const payer = { id: 'payer', fullName: 'Payer', plots: ['3', '4'], plotName: '3, 4' }
  await createPaymentRequest(db, payer, 2000, [], 'За ноябрь')
  const [path, request] = [...db.values.entries()].find(([path]) => path.startsWith('payment_requests/auto-'))
  assert.deepEqual(request.plotIds, ['3', '4'])
  await confirmPaymentRequest(db, reviewer, path.split('/')[1])
  assert.equal(db.values.get('plots/plot-03').balance, 1000)
  assert.equal(db.values.get('plots/plot-04').balance, 1000)
  assert.equal(db.values.get('users/payer').balance, 2000)
  assert.equal(db.values.get('users/shared3').balance, 1000)
  assert.equal(db.values.get('users/other4').balance, 1000)
})

test('account with missing plots reports its configuration problem before creating a request', async () => {
  const db = createStore({ 'users/payer': { plotName: '3' } })
  const payer = { id: 'payer', fullName: 'Payer', plots: [], plotName: '3' }
  await assert.rejects(createPaymentRequest(db, payer, 1000, [], 'За ноябрь'), /привязку участков/)
  assert.equal([...db.values.keys()].some(path => path.startsWith('payment_requests/')), false)
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

test('every plot from 1 to 35 can report payment and credit its shared owners', async () => {
  const allPlots = Object.fromEntries(Array.from({ length: 35 }, (_, index) => [
    `plots/plot-${String(index + 1).padStart(2, '0')}`, { name: `Участок ${index + 1}`, balance: -1000 },
  ]))
  for (let number = 1; number <= 35; number++) {
    const db = createStore({
      ...allPlots,
      'app_settings/community_funds': { amount: 0 },
      'users/payer': { plots: [String(number)], balance: -1000 },
      'users/shared': { plots: [String(number)], balance: -1000 },
    })
    const payer = { id: 'payer', fullName: 'Payer', plots: [String(number)], plotName: String(number) }
    await createPaymentRequest(db, payer, 1000, [], 'За ноябрь')
    const [path, request] = [...db.values.entries()].find(([path]) => path.startsWith('payment_requests/'))
    assert.deepEqual(request.plotIds, [String(number)])
    await confirmPaymentRequest(db, reviewer, path.split('/')[1])
    assert.equal(db.values.get('users/payer').balance, 0)
    assert.equal(db.values.get('users/shared').balance, 0)
    assert.equal(db.values.get('app_settings/community_funds').amount, 1000)
    for (let other = 1; other <= 35; other++) {
      assert.equal(db.values.get(`plots/plot-${String(other).padStart(2, '0')}`).balance, other === number ? 0 : -1000)
    }
  }
})

test('unregistered plot balance can be corrected without creating a resident account', async () => {
  const db = createStore(seed())
  const placeholder = { id: 'placeholder:plot-01', fullName: 'Собственник не зарегистрирован', isPlaceholder: true, plots: ['Участок 1'], plotName: 'Участок 1', balance: 0 }
  await setUserBalance(db, reviewer, placeholder, -5000)
  assert.equal(db.values.get('plots/plot-01').balance, -5000)
  assert.equal(db.values.get('plots/plot-02').balance, 0)
  assert.equal(db.values.has('users/placeholder:plot-01'), false)
  await assert.rejects(setUserBalance(db, reviewer, placeholder, -1000), /Баланс уже изменился/)
  const registered = { ...placeholder, id: 'placeholder:plot-03', plots: ['Участок 3'], plotName: 'Участок 3' }
  await assert.rejects(setUserBalance(db, reviewer, registered, -1000), /уже зарегистрирован/)
  assert.equal(db.values.get('plots/plot-03').balance, 0)
})

test('registration racing a charge and payment receives the final plot balance', async () => {
  const values = seed()
  values['registration_requests/new-owner'] = {
    status: 'PENDING', requestType: 'REGISTRATION', plots: ['3'], fullName: 'New owner',
    phone: '89160000000', authEmail: 'new@example.test', login: 'new-owner',
  }
  const db = createStore(values)
  await Promise.all([
    approveRegistrationRequest(db, reviewer, { id: 'new-owner', requestType: 'REGISTRATION' }),
    createEvent(db, reviewer, { type: 'CHARGE', title: 'Collection', message: '', amount: 1000 }),
    confirmPaymentRequest(db, reviewer, 'a'),
  ])
  assert.equal(db.values.get('plots/plot-03').balance, -900)
  assert.equal(db.values.get('users/new-owner').balance, -900)
  assert.equal(db.values.get('users/shared3').balance, -900)
  assert.ok(db.retries > 0)
})

test('registration racing a placeholder correction keeps the new owner in sync', async () => {
  const values = seed()
  values['registration_requests/new-owner'] = {
    status: 'PENDING', requestType: 'REGISTRATION', plots: ['1'], fullName: 'New owner',
    phone: '89160000000', authEmail: 'new@example.test', login: 'new-owner',
  }
  const db = createStore(values)
  const placeholder = { id: 'placeholder:plot-01', isPlaceholder: true, fullName: 'Placeholder', plots: ['Участок 1'], plotName: 'Участок 1', balance: 0 }
  const results = await Promise.allSettled([
    approveRegistrationRequest(db, reviewer, { id: 'new-owner', requestType: 'REGISTRATION' }),
    setUserBalance(db, reviewer, placeholder, -5000),
  ])
  assert.equal(results[0].status, 'fulfilled')
  if (results[1].status === 'rejected') assert.match(results[1].reason.message, /уже зарегистрирован/)
  assert.equal(db.values.get('users/new-owner').balance, db.values.get('plots/plot-01').balance)
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
