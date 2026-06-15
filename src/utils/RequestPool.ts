/**
 * Executes an array of tasks with bounded concurrency.
 * Results are returned in the same order as the input tasks.
 * A task that throws stores null in the result at that index.
 */
export class RequestPool {
  constructor(private readonly maxConcurrent: number) {}

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
        results[idx] = await handler(tasks[idx]!)
        onProgress?.(++done, tasks.length)
      }
    }

    const workerCount = Math.min(this.maxConcurrent, tasks.length)
    await Promise.all(Array.from({ length: workerCount }, worker))
    return results
  }
}
