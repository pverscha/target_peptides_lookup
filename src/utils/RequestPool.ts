import type { PauseController } from './PauseController'

/**
 * Executes an array of tasks with bounded concurrency.
 * Results are returned in the same order as the input tasks.
 * A task that throws stores null in the result at that index.
 *
 * When a PauseController is provided, each worker gates on it before
 * dispatching a task, so pausing halts new dispatches at the next iteration
 * boundary while in-flight tasks finish.
 */
export class RequestPool {
  constructor(
    private readonly maxConcurrent: number,
    private readonly pause?: PauseController | null,
  ) {}

  async execute<T, R>(
    tasks: T[],
    handler: (task: T) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<(R | null)[]> {
    const results = new Array<R | null>(tasks.length).fill(null)
    let nextIdx = 0
    let done = 0

    const worker = async (): Promise<void> => {
      let idx: number
      while ((idx = nextIdx++) < tasks.length) {
        if (this.pause) await this.pause.wait()
        results[idx] = await handler(tasks[idx]!)
        onProgress?.(++done, tasks.length)
      }
    }

    const workerCount = Math.min(this.maxConcurrent, tasks.length)
    await Promise.all(Array.from({ length: workerCount }, worker))
    return results
  }
}
