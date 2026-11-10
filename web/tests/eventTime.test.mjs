import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return next(url.href, context)
  }
  return next(specifier, context)
} })
const { extractCreatedAt } = await import('../src/utils.ts')

test('timestamps within the same second remain ordered for unread cursors', () => {
  const first = extractCreatedAt({ seconds: 1_800_000_000, nanoseconds: 123_000_000 }, 0)
  const next = extractCreatedAt({ seconds: 1_800_000_000, nanoseconds: 456_000_000 }, 0)
  assert.equal(first, 1_800_000_000_123)
  assert.equal(next, 1_800_000_000_456)
  assert.ok(next > first, 'a later message in the same second must remain unread')
})

test('legacy timestamps without nanoseconds still work and epoch zero stays valid', () => {
  assert.equal(extractCreatedAt({ seconds: 42 }, 100), 42_000)
  assert.equal(extractCreatedAt({ seconds: 0, nanoseconds: 0 }, 100), 0)
})

test('missing or invalid server timestamps use a valid client fallback', () => {
  assert.equal(extractCreatedAt(null, 1_800_000_000_789), 1_800_000_000_789)
  assert.equal(extractCreatedAt(undefined, '1234'), 1234)
  assert.equal(extractCreatedAt({ seconds: 'invalid' }, 5678), 5678)
})

test('missing, zero or invalid fallback never produces NaN or Infinity', () => {
  assert.equal(extractCreatedAt(null, 0), 0)
  assert.equal(extractCreatedAt(undefined, undefined), 0)
  assert.equal(extractCreatedAt(null, 'invalid'), 0)
  assert.equal(extractCreatedAt(null, Infinity), 0)
})
