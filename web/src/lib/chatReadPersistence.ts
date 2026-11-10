type CursorState = {
  confirmed: number
  requested: number
  inFlight: Promise<void> | null
  timer: unknown | null
  retryAt: number
  failures: number
  cancelled: boolean
}

type ReadCursorOptions<Context extends object> = {
  persist: (context: Context, userId: string, cursor: number) => Promise<number>
  isCurrentSession: (context: Context, userId: string) => boolean
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
}

function validCursor(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

// Scroll, layout settling and focus can all report the same message at once.
// Keep one writer per account and collapse those reports to the newest cursor.
export function createChatReadPersistence<Context extends object>(options: ReadCursorOptions<Context>) {
  const contexts = new WeakMap<Context, Map<string, CursorState>>()
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? (timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))

  const discard = (context: Context, userId: string, state: CursorState) => {
    state.cancelled = true
    if (state.timer !== null) clearTimer(state.timer)
    state.timer = null
    const users = contexts.get(context)
    if (users?.get(userId) === state) users.delete(userId)
  }

  const start = (context: Context, userId: string, state: CursorState): Promise<void> => {
    if (state.inFlight) return state.inFlight
    if (state.timer !== null) clearTimer(state.timer)
    state.timer = null
    const operation = Promise.resolve().then(async () => {
      let attemptedTarget = state.requested
      try {
        while (!state.cancelled && state.requested > state.confirmed) {
          if (!options.isCurrentSession(context, userId)) { discard(context, userId, state); return }
          const target = state.requested
          attemptedTarget = target
          const persisted = validCursor(await options.persist(context, userId, target))
          if (!options.isCurrentSession(context, userId)) { discard(context, userId, state); return }
          if (persisted < target) throw new Error('Не удалось сохранить отметку прочтения.')
          state.confirmed = Math.max(state.confirmed, persisted)
        }
        state.failures = 0
        state.retryAt = 0
      } catch (error) {
        if (!options.isCurrentSession(context, userId)) { discard(context, userId, state); return }
        state.failures = Math.min(state.failures + 1, 6)
        state.retryAt = now() + Math.min(10_000 * 2 ** (state.failures - 1), 300_000)
        // A newer message reported while the failed request was pending still needs a turn.
        if (state.requested > attemptedTarget) queueRetry(context, userId, state)
        throw error
      }
    }).finally(() => {
      if (state.inFlight === operation) state.inFlight = null
      // A report can arrive in the microtask between draining and finalization.
      if (!state.cancelled && state.requested > state.confirmed && now() >= state.retryAt) {
        void start(context, userId, state).catch(() => undefined)
      }
    })
    state.inFlight = operation
    return operation
  }

  function queueRetry(context: Context, userId: string, state: CursorState) {
    if (state.timer !== null) return
    state.timer = setTimer(() => {
      state.timer = null
      if (!options.isCurrentSession(context, userId)) { discard(context, userId, state); return }
      if (state.requested > state.confirmed) void start(context, userId, state).catch(() => undefined)
    }, Math.max(0, state.retryAt - now()))
  }

  return (context: Context, userId: string, latestSeen: number, currentLastReadAt: number): Promise<void> => {
    const target = validCursor(latestSeen)
    if (!userId || !target) return Promise.resolve()
    let users = contexts.get(context)
    const previous = users?.get(userId)
    if (!options.isCurrentSession(context, userId)) {
      if (previous) discard(context, userId, previous)
      return Promise.resolve()
    }
    if (!users) { users = new Map(); contexts.set(context, users) }
    const state = previous ?? { confirmed: 0, requested: 0, inFlight: null, timer: null, retryAt: 0, failures: 0, cancelled: false }
    users.set(userId, state)
    state.confirmed = Math.max(state.confirmed, validCursor(currentLastReadAt))
    state.requested = Math.max(state.requested, target)
    if (state.requested <= state.confirmed) {
      if (state.timer !== null) clearTimer(state.timer)
      state.timer = null
      return Promise.resolve()
    }
    if (state.inFlight) return state.inFlight
    if (now() < state.retryAt) {
      queueRetry(context, userId, state)
      return Promise.resolve()
    }
    return start(context, userId, state)
  }
}
