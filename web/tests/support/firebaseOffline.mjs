export const auth = null, rtdb = null
export function getAuth() { throw new Error('Authentication is not used in offline payment tests') }
export function push() { throw new Error('No notifications may leave offline tests') }
export const ref = push, set = push
