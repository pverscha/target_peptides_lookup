import { SuspendableGate } from './SuspendableGate'

/**
 * Failure-driven cooperative pause for the fetch layer. A failing request calls
 * `waitForResume()`, which closes the gate on the first failure (firing
 * `onInterrupt` once) and parks until the user resumes. Because the request
 * parks instead of throwing, the in-flight pipeline step never unwinds and
 * mid-step progress is preserved.
 */
export class RetryController extends SuspendableGate {
  constructor(private readonly onInterrupt?: () => void) {
    super()
  }

  get interrupted(): boolean {
    return this.closed
  }

  /** Called by the fetch layer on a failure. Resolves when `resume()` runs. */
  waitForResume(): Promise<void> {
    if (!this.closed) {
      this.close()
      this.onInterrupt?.()
    }
    return this.wait()
  }
}
