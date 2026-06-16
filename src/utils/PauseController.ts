import { SuspendableGate } from './SuspendableGate'

/**
 * Caller-driven cooperative pause. `pause()` closes the gate; loops awaiting
 * `wait()` then park until `resume()`. Pausing takes effect at the next
 * iteration boundary, so in-flight work finishes first.
 */
export class PauseController extends SuspendableGate {
  get paused(): boolean {
    return this.closed
  }

  pause(): void {
    this.close()
  }
}
