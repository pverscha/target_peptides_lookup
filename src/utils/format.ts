export function fmtN(n: number): string {
  return n.toLocaleString()
}

export function fmtPercent(done: number, total: number): string {
  return `${((done / total) * 100).toFixed(1)}%`
}

export function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8)
}

export function formatLogLines(logs: { timestamp: Date; level: string; message: string }[]): string {
  return logs.map(e => `[${formatTime(e.timestamp)}] [${e.level}] ${e.message}`).join('\n')
}
