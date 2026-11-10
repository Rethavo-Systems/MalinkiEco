type Point = { x: number; y: number }
type Clock = {
  now: () => number
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
}

// Mobile browsers can dispatch a click after touchend even when preventDefault
// is ignored by a passive touch listener. Keep that click away from photo buttons.
export class ChatLongPress {
  private timer: ReturnType<typeof setTimeout> | null = null
  private origin: Point | null = null
  private triggered = false
  private suppressClickUntil = 0
  private clock: Clock
  constructor(clock: Clock = { now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout }) { this.clock = clock }

  start(point: Point, onHold: () => void) {
    this.cancel()
    this.origin = point
    this.timer = this.clock.setTimer(() => {
      this.timer = null
      this.triggered = true
      this.suppressClickUntil = this.clock.now() + 1000
      onHold()
    }, 420)
  }

  move(point: Point) {
    if (!this.triggered && this.origin && Math.hypot(point.x - this.origin.x, point.y - this.origin.y) > 10) this.cancel()
  }

  finish() {
    const held = this.triggered
    this.cancel()
    return held
  }

  cancel() {
    if (this.timer !== null) this.clock.clearTimer(this.timer)
    if (this.triggered) this.suppressClickUntil = this.clock.now() + 800
    this.timer = null
    this.origin = null
    this.triggered = false
  }

  consumeClick() {
    if (this.clock.now() >= this.suppressClickUntil) return false
    this.suppressClickUntil = 0
    return true
  }
}
