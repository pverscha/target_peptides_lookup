export function downloadText(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
