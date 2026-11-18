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

const { voteInPoll } = await import('../src/lib/appApi.ts')
const poll = { id: 'poll', type: 'POLL', isClosed: false, pollOptions: ['Да', 'Нет'], pollVotes: { Да: 0, Нет: 0 }, voterIds: [], voterChoices: {} }

test('concurrent residents cast one vote each without overwriting earlier choices', async () => {
  const db = createStore({ 'events/poll': poll })
  await Promise.all([
    voteInPoll(db, { id: 'alice' }, poll, 'Да'),
    voteInPoll(db, { id: 'bob' }, poll, 'Нет'),
  ])
  const result = db.values.get('events/poll')
  assert.deepEqual(result.pollVotes, { Да: 1, Нет: 1 })
  assert.deepEqual(new Set(result.voterIds), new Set(['alice', 'bob']))
  assert.deepEqual(result.voterChoices, { alice: 'Да', bob: 'Нет' })
})

test('a repeated vote is a no-op and a closed poll or missing option rejects the write', async () => {
  const db = createStore({ 'events/poll': poll })
  await voteInPoll(db, { id: 'alice' }, poll, 'Да')
  const voted = structuredClone(db.values.get('events/poll'))
  await voteInPoll(db, { id: 'alice' }, poll, 'Нет')
  assert.deepEqual(db.values.get('events/poll'), voted)
  await assert.rejects(voteInPoll(db, { id: 'bob' }, poll, 'Другой'), /Вариант ответа/)
  db.values.get('events/poll').isClosed = true
  await assert.rejects(voteInPoll(db, { id: 'bob' }, poll, 'Нет'), /завершено/)
  assert.equal(db.values.get('events/poll').voterIds.length, 1)
})

test('legacy poll without vote maps or isClosed accepts its first normal vote', async () => {
  const legacy = { id: 'poll', type: 'POLL', pollOptions: ['Да', 'Нет'] }
  const db = createStore({ 'events/poll': legacy })
  await voteInPoll(db, { id: 'alice' }, legacy, 'Да')
  const result = db.values.get('events/poll')
  assert.deepEqual(result.pollVotes, { Да: 1 })
  assert.deepEqual(result.voterIds, ['alice'])
  assert.deepEqual(result.voterChoices, { alice: 'Да' })
})

test('anonymous concurrent votes expose totals while each response stays in its private document', async () => {
  const anonymous = { ...poll, createdById: 'creator', isAnonymous: true }
  const db = createStore({ 'events/poll': anonymous })
  await Promise.all([
    voteInPoll(db, { id: 'alice' }, anonymous, 'Да'),
    voteInPoll(db, { id: 'bob' }, anonymous, 'Нет'),
  ])
  const result = db.values.get('events/poll')
  assert.deepEqual(result.pollVotes, { Да: 1, Нет: 1 })
  assert.deepEqual(result.voterIds, [])
  assert.deepEqual(result.voterChoices, {})
  assert.deepEqual(db.values.get('poll_votes/alice/votes/poll'), { option: 'Да' })
  assert.deepEqual(db.values.get('poll_votes/bob/votes/poll'), { option: 'Нет' })
  assert.equal(JSON.stringify(result).includes('alice'), false)
  assert.equal(JSON.stringify(result).includes('bob'), false)
})

test('two devices for one anonymous voter commit only one private response and count', async () => {
  const anonymous = { ...poll, isAnonymous: true }
  const db = createStore({ 'events/poll': anonymous })
  await Promise.all([
    voteInPoll(db, { id: 'alice' }, anonymous, 'Да'),
    voteInPoll(db, { id: 'alice' }, anonymous, 'Нет'),
  ])
  const result = db.values.get('events/poll')
  assert.equal(Object.values(result.pollVotes).reduce((sum, count) => sum + count, 0), 1)
  assert.equal([...db.values.keys()].filter(path => path.startsWith('poll_votes/')).length, 1)
  assert.deepEqual(result.voterIds, [])
  const chosen = db.values.get('poll_votes/alice/votes/poll').option
  assert.equal(result.pollVotes[chosen], 1)
})

test('anonymous vote response and aggregate are atomic on failure', async () => {
  const anonymous = { ...poll, isAnonymous: true }
  for (const failure of ['poll_votes/', 'events/']) {
    const db = createStore({ 'events/poll': anonymous })
    db.failPath = failure
    await assert.rejects(voteInPoll(db, { id: 'alice' }, anonymous, 'Да'), /commit failure/)
    assert.deepEqual(db.values.get('events/poll'), anonymous)
    assert.equal(db.values.has('poll_votes/alice/votes/poll'), false)
  }
})
