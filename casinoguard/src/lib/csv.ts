export type CsvColumn = { key: string; label?: string }

export function toCSV(rows: Record<string, unknown>[], columns?: CsvColumn[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }))
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.map((c) => esc(c.label ?? c.key)).join(',')
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))
  return [head, ...body].join('\n')
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[], columns?: CsvColumn[]) {
  const blob = new Blob([toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
