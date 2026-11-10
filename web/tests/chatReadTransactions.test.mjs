import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { createStore } from './support/firestoreMemory.mjs'
import { auth } from './support/chatReadAuth.mjs'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'firebase/firestore') return next(new URL('./support/firestoreMemory.mjs', import.meta.url).href, context)
  if (specifier === './firebase' && context.parentURL?.includes('/src/lib/')) return next(new URL('./support/chatReadAuth.mjs', import.meta.url).href, context)
  if (['firebase/auth', 'firebase/database'].includes(specifier)) return next(new URL('./support/firebaseOffline.mjs', import.meta.url).href, context)
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return next(url.href, context)
  }
  return next(specifier, context)
} })
const { markChatRead } = await import('../src/lib/appApi.ts')

test('the real markChatRead API collapses simultaneous reports and skips acknowledged cursors without a transaction', async () => {
  auth.currentUser = { uid: 'reader' }
  const db = createStore({ 'users/reader': { lastChatReadAt: 100 } })
  await markChatRead(db, 'reader', 100, 100)
  assert.equal(db.transactionCalls, 0)
  await Promise.all(Array.from({ length: 40 }, (_, index) => markChatRead(db, 'reader', 101 + index, 100)))
  assert.equal(db.transactionCalls, 1)
  assert.equal(db.values.get('users/reader').lastChatReadAt, 140)
  assert.equal(db.versions.get('users/reader'), 1)
  await markChatRead(db, 'reader', 140, 0)
  assert.equal(db.transactionCalls, 1, 'stale profile state must not cause another RPC')
})

test('a fresh server cursor is never lowered and then prevents redundant transactions', async () => {
  auth.currentUser = { uid: 'reader' }
  const db = createStore({ 'users/reader': { lastChatReadAt: 500 } })
  await markChatRead(db, 'reader', 200, 0)
  assert.equal(db.values.get('users/reader').lastChatReadAt, 500)
  assert.equal(db.versions.get('users/reader'), undefined)
  await markChatRead(db, 'reader', 400, 0)
  assert.equal(db.transactionCalls, 1)
})

test('a queued write for a previous session never starts a Firestore transaction', async () => {
  auth.currentUser = { uid: 'reader' }
  const db = createStore({ 'users/reader': { lastChatReadAt: 0 } })
  const pending = markChatRead(db, 'reader', 100, 0)
  auth.currentUser = { uid: 'another-account' }
  await pending
  assert.equal(db.transactionCalls, 0)
  assert.equal(db.values.get('users/reader').lastChatReadAt, 0)
  auth.currentUser = null
  await markChatRead(db, 'reader', 200, 0)
  assert.equal(db.transactionCalls, 0)
})

test('a session change after reading the document prevents the commit and permits a fresh later session', async () => {
  auth.currentUser = { uid: 'reader' }
  const db = createStore({ 'users/reader': { lastChatReadAt: 0 } })
  const pending = markChatRead(db, 'reader', 100, 0)
  await Promise.resolve()
  assert.equal(db.transactionCalls, 1, 'the transaction has already reached its asynchronous read')
  auth.currentUser = null
  await pending
  assert.equal(db.values.get('users/reader').lastChatReadAt, 0)
  assert.equal(db.versions.get('users/reader'), undefined)
  auth.currentUser = { uid: 'reader' }
  await markChatRead(db, 'reader', 200, 0)
  assert.equal(db.values.get('users/reader').lastChatReadAt, 200)
})
