/**
 * A cooperative gate that long-running loops await at each iteration boundary.
 *
 * While the gate is closed, `wait()` parks the caller; `resume()` reopens the
 * gate and releases every parked caller at once. This class owns only the
 * park/release mechanism — pause and retry semantics are layered on top by
 * subclasses (who decides when the gate closes, and what happens on closing).
 */
export class SuspendableGate {
  private _closed = false
  private waiters: Array<() => void> = []

  get closed(): boolean {
    return this._closed
  }

  protected close(): void {
    this._closed = true
  }

  /** Resolves immediately when open; otherwise parks until `resume()` runs. */
  wait(): Promise<void> {
    if (!this._closed) return Promise.resolve()
    return new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  /** Reopen the gate and release all parked callers. */
  resume(): void {
    this._closed = false
    const waiters = this.waiters
    this.waiters = []
    for (const release of waiters) release()
  }
}
