import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatReadPersistence } from '../src/lib/chatReadPersistence.ts'

const settle = async () => { for (let index = 0; index < 15; index++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fakeClock() {
  let time = 0, id = 0
  const timers = new Map()
  return {
    now: () => time,
    setTimer: (callback, delay) => { timers.set(++id, { callback, due: time + delay }); return id },
    clearTimer: timer => timers.delete(timer),
    count: () => timers.size,
    async advance(duration) {
      time += duration
      for (const [key, timer] of [...timers]) {
        if (timer.due <= time) { timers.delete(key); timer.callback() }
      }
      await settle()
    },
  }
}

test('a burst of scroll/focus reports produces one write of the newest cursor and no RPC for confirmed reports', async () => {
  const context = {}, saved = []
  const report = createChatReadPersistence({ isCurrentSession: () => true, persist: async (_db, _user, cursor) => { saved.push(cursor); return cursor } })
  await Promise.all(Array.from({ length: 100 }, (_, index) => report(context, 'reader', index + 1, 0)))
  assert.deepEqual(saved, [100])
  await Promise.all([report(context, 'reader', 100, 0), report(context, 'reader', 99, 0), report(context, 'reader', 80, 120)])
  assert.deepEqual(saved, [100])
})

test('messages arriving during an in-flight write share one next write and never run concurrently', async () => {
  const context = {}, gate = deferred(), saved = []
  let active = 0, maxActive = 0
  const report = createChatReadPersistence({ isCurrentSession: () => true, persist: async (_db, _user, cursor) => {
    saved.push(cursor); maxActive = Math.max(maxActive, ++active)
    if (cursor === 100) await gate.promise
    active--; return cursor
  } })
  const first = report(context, 'reader', 100, 0)
  await settle()
  const newer = report(context, 'reader', 300, 0)
  const older = report(context, 'reader', 200, 0)
  assert.deepEqual(saved, [100])
  gate.resolve(); await Promise.all([first, newer, older])
  assert.deepEqual(saved, [100, 300]); assert.equal(maxActive, 1)
})

test('a failed commit is backed off, repeated events queue one retry, and a newer message survives the cooldown', async () => {
  const context = {}, clock = fakeClock(), saved = []
  let fail = true
  const report = createChatReadPersistence({ ...clock, isCurrentSession: () => true, persist: async (_db, _user, cursor) => {
    saved.push(cursor); if (fail) throw new Error('failed-precondition'); return cursor
  } })
  await assert.rejects(report(context, 'reader', 100, 0), /failed-precondition/)
  assert.equal(clock.count(), 0, 'failure alone must not create an autonomous retry loop')
  await Promise.all(Array.from({ length: 100 }, (_, index) => report(context, 'reader', 101 + index, 0)))
  assert.equal(clock.count(), 1); assert.deepEqual(saved, [100])
  await clock.advance(9_999); assert.deepEqual(saved, [100])
  fail = false; await clock.advance(1)
  assert.deepEqual(saved, [100, 200]); assert.equal(clock.count(), 0)
  await report(context, 'reader', 200, 0); assert.deepEqual(saved, [100, 200])
})

test('background failure is contained and subsequent reports use increasing backoff', async () => {
  const context = {}, clock = fakeClock(), saved = []
  let fail = true
  const report = createChatReadPersistence({ ...clock, isCurrentSession: () => true, persist: async (_db, _user, cursor) => {
    saved.push(cursor); if (fail) throw new Error('offline'); return cursor
  } })
  await assert.rejects(report(context, 'reader', 100, 0), /offline/)
  await report(context, 'reader', 200, 0)
  await clock.advance(10_000)
  assert.deepEqual(saved, [100, 200]); assert.equal(clock.count(), 0)
  await Promise.all(Array.from({ length: 20 }, () => report(context, 'reader', 300, 0)))
  assert.equal(clock.count(), 1)
  await clock.advance(19_999); assert.deepEqual(saved, [100, 200])
  fail = false; await clock.advance(1)
  assert.deepEqual(saved, [100, 200, 300])
})

test('a newer message reported during a failing in-flight write gets one delayed turn', async () => {
  const context = {}, clock = fakeClock(), gate = deferred(), saved = []
  const report = createChatReadPersistence({ ...clock, isCurrentSession: () => true, persist: async (_db, _user, cursor) => {
    saved.push(cursor)
    if (cursor === 100) { await gate.promise; throw new Error('offline') }
    return cursor
  } })
  const first = report(context, 'reader', 100, 0)
  await settle()
  const newer = report(context, 'reader', 200, 0)
  gate.resolve()
  await Promise.all([assert.rejects(first), assert.rejects(newer)])
  assert.equal(clock.count(), 1)
  await clock.advance(10_000)
  assert.deepEqual(saved, [100, 200]); assert.equal(clock.count(), 0)
})

test('logout or a different session cancels the delayed old-account write without an RPC', async () => {
  const context = {}, clock = fakeClock(), saved = []
  let session = 'first', fail = true
  const report = createChatReadPersistence({ ...clock, isCurrentSession: (_db, user) => user === session, persist: async (_db, user, cursor) => {
    saved.push([user, cursor]); if (fail) throw new Error('offline'); return cursor
  } })
  await assert.rejects(report(context, 'first', 100, 0))
  await report(context, 'first', 200, 0)
  session = 'second'; fail = false
  await report(context, 'second', 300, 0)
  await clock.advance(10_000)
  assert.deepEqual(saved, [['first', 100], ['second', 300]])
  session = 'first'; await report(context, 'first', 200, 0)
  assert.deepEqual(saved.at(-1), ['first', 200])
  session = null; await report(context, 'first', 400, 0)
  assert.equal(saved.length, 3)
})

test('a fresher server cursor or profile snapshot prevents redundant reads and cancels queued work', async () => {
  const context = {}, clock = fakeClock(), saved = []
  let fail = false
  const report = createChatReadPersistence({ ...clock, isCurrentSession: () => true, persist: async (_db, _user, cursor) => {
    saved.push(cursor); if (fail) throw new Error('offline'); return Math.max(500, cursor)
  } })
  await report(context, 'reader', 100, 0)
  await report(context, 'reader', 400, 0)
  assert.deepEqual(saved, [100])
  fail = true; await assert.rejects(report(context, 'reader', 600, 0))
  await report(context, 'reader', 700, 0); assert.equal(clock.count(), 1)
  await report(context, 'reader', 700, 700); assert.equal(clock.count(), 0)
  await clock.advance(600_000); assert.deepEqual(saved, [100, 600])
})

test('invalid cursors never start persistence and accounts/databases keep independent cursors', async () => {
  const firstDb = {}, secondDb = {}, saved = []
  const report = createChatReadPersistence({ isCurrentSession: () => true, persist: async (db, user, cursor) => { saved.push([db, user, cursor]); return cursor } })
  await Promise.all([report(firstDb, 'a', NaN, 0), report(firstDb, 'a', Infinity, 0), report(firstDb, '', 100, 0), report(firstDb, 'a', -1, 0)])
  assert.equal(saved.length, 0)
  await report(firstDb, 'a', 100, 0); await report(firstDb, 'b', 50, 0); await report(secondDb, 'a', 25, 0)
  assert.equal(saved.length, 3)
})
