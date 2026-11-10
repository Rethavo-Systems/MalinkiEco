import assert from 'node:assert/strict'

// No network client. Optimistic version checks exercise retries in the real appApi callbacks.
export function createStore(seed = {}) {
  return { values: new Map(Object.entries(structuredClone(seed))), versions: new Map(), retries: 0, failPath: '' }
}
let nextId = 0
export function collection(db, path) { return { db, path } }
export function doc(dbOrCollection, ...segments) {
  const db = dbOrCollection.db ?? dbOrCollection
  const path = dbOrCollection.db ? `${dbOrCollection.path}/${segments[0] ?? `auto-${++nextId}`}` : segments.join('/')
  return { db, path, id: path.split('/').at(-1) }
}
function snapshot(reference) {
  const data = structuredClone(reference.db.values.get(reference.path))
  return { ref: reference, id: reference.id, exists: () => data !== undefined, data: () => data }
}
export async function getDocs(reference) {
  const docs = [...reference.db.values.keys()].filter(path => path.startsWith(`${reference.path}/`) && path.split('/').length === 2)
    .map(path => snapshot(doc(reference.db, path)))
  return { docs }
}
export function serverTimestamp() { return { seconds: 1234567890 } }
function commit(db, writes) {
  for (const write of writes) {
    if (db.failPath && write.ref.path.startsWith(db.failPath)) throw new Error('Simulated commit failure')
    if (write.update && !db.values.has(write.ref.path)) throw new Error('Missing update document')
  }
  for (const write of writes) {
    const value = write.merge || write.update ? { ...db.values.get(write.ref.path), ...write.value } : write.value
    db.values.set(write.ref.path, structuredClone(value))
    db.versions.set(write.ref.path, (db.versions.get(write.ref.path) ?? 0) + 1)
  }
}
export async function runTransaction(db, callback) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const reads = new Map(), writes = []
    const result = await callback({
      async get(ref) {
        assert.equal(writes.length, 0, 'Firestore requires all reads before writes')
        reads.set(ref.path, db.versions.get(ref.path) ?? 0)
        return snapshot(ref)
      },
      set(ref, value, options) { writes.push({ ref, value, merge: options?.merge }) },
      update(ref, value) { writes.push({ ref, value, update: true }) },
    })
    if ([...reads].some(([path, version]) => (db.versions.get(path) ?? 0) !== version)) { db.retries++; continue }
    commit(db, writes)
    return result
  }
  throw new Error('Too much contention')
}
export function writeBatch(db) {
  const writes = []
  return {
    set(ref, value, options) { writes.push({ ref, value, merge: options?.merge }) },
    update(ref, value) { writes.push({ ref, value, update: true }) },
    async commit() { commit(db, writes) },
  }
}
export async function addDoc(reference, value) { const ref = doc(reference); commit(reference.db, [{ref,value}]); return ref }
export async function setDoc(ref, value) { commit(ref.db, [{ref,value}]) }
export async function updateDoc(ref, value) { commit(ref.db, [{ref,value,update:true}]) }
export async function deleteDoc(ref) {
  if (ref.db.failPath && ref.path.startsWith(ref.db.failPath)) throw new Error('Simulated delete failure')
  ref.db.values.delete(ref.path)
  ref.db.versions.set(ref.path, (ref.db.versions.get(ref.path) ?? 0) + 1)
}
