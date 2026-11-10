import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createStore } from './support/firestoreMemory.mjs'

registerHooks({resolve(specifier, context, next) {
  return next(specifier === 'firebase/firestore' ? new URL('./support/firestoreMemory.mjs',import.meta.url).href : specifier,context)
}})
let subscription = null
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{
  userAgent:'offline test',serviceWorker:{register:async()=>({active:{},pushManager:{getSubscription:async()=>subscription}})},
}})
globalThis.window = {matchMedia:()=>({matches:false}), navigator:globalThis.navigator}
const {disableStoredWebPushSubscription,createSubscriptionDocumentId,saveWebPushSubscription} = await import('../src/lib/webPush.ts')
const makeSubscription = (unsubscribe = async()=>true) => ({
  endpoint:'https://push.example.test/isolated-test',unsubscribe,
  toJSON:()=>({keys:{p256dh:'test-key',auth:'test-auth'},expirationTime:null}),
})
test('disabling attempts browser unsubscribe even when server cleanup fails', async () => {
  const db = createStore(); db.failPath = 'web_push_subscriptions/'
  let stopped = false; subscription = makeSubscription(async()=>{stopped=true;return true})
  assert.equal(await disableStoredWebPushSubscription(db),false)
  assert.equal(stopped,true)
})
test('server deletion stops delivery when browser unsubscribe fails', async () => {
  const db = createStore(); subscription = makeSubscription(async()=>{throw new Error('Browser offline')})
  const id = await createSubscriptionDocumentId(subscription)
  db.values.set(`web_push_subscriptions/${id}`,{userId:'resident'})
  assert.equal(await disableStoredWebPushSubscription(db),false)
  assert.equal(db.values.has(`web_push_subscriptions/${id}`),false)
})
test('failure on both sides is reported instead of claiming push is disabled', async () => {
  const db = createStore(); db.failPath = 'web_push_subscriptions/'
  subscription = makeSubscription(async()=>{throw new Error('Browser failed')})
  await assert.rejects(disableStoredWebPushSubscription(db),/Не удалось отключить/)
})
test('missing subscription is already disabled; incomplete keys are never stored', async () => {
  const db = createStore(); subscription = null
  assert.equal(await disableStoredWebPushSubscription(db),true)
  await assert.rejects(saveWebPushSubscription(db,{id:'resident'},{toJSON:()=>({keys:{}})}),/неполную подписку/)
  assert.equal(db.values.size,0)
})
