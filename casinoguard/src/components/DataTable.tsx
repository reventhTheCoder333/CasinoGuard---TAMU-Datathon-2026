import { useMemo, useState, type ReactNode } from 'react'
import { downloadCSV } from '../lib/csv'

export interface Column<T> {
  key: string
  label: ReactNode
  /** CSV header (defaults to key) */
  csv?: string
  num?: boolean
  render?: (row: T) => ReactNode
  value?: (row: T) => number | string | null | undefined
  sortable?: boolean
  wrap?: boolean
  title?: string
}

export function DataTable<T extends object>({
  rows, columns, rowKey, searchKeys, initialSort, pageSize = 15, onRowClick, selectedKey, csvName, toolbar, searchPlaceholder = 'Search…', emptyText = 'No rows match the current filters.',
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (r: T) => string
  searchKeys?: (keyof T)[]
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  pageSize?: number
  onRowClick?: (r: T) => void
  selectedKey?: string | null
  csvName?: string
  toolbar?: ReactNode
  searchPlaceholder?: string
  emptyText?: string
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)

  const getVal = (r: T, c: Column<T>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]) as number | string | null | undefined

  const filtered = useMemo(() => {
    if (!q.trim() || !searchKeys?.length) return rows
    const s = q.trim().toLowerCase()
    return rows.filter((r) => searchKeys.some((k) => String((r as Record<string, unknown>)[k as string] ?? '').toLowerCase().includes(s)))
  }, [rows, q, searchKeys])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = getVal(a, col), vb = getVal(b, col)
      if (va === null || va === undefined || (typeof va === 'number' && isNaN(va))) return 1
      if (vb === null || vb === undefined || (typeof vb === 'number' && isNaN(vb))) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pg = Math.min(page, pages - 1)
  const view = sorted.slice(pg * pageSize, pg * pageSize + pageSize)

  const toggleSort = (key: string) => {
    setPage(0)
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  }

  const exportCsv = () => {
    const out = sorted.map((r) => {
      const o: Record<string, unknown> = {}
      columns.forEach((c) => { o[c.csv ?? c.key] = getVal(r, c) })
      return o
    })
    downloadCSV(csvName ?? 'casinoguard-export', out)
  }

  return (
    <div>
      <div className="table-tools">
        {searchKeys && (
          <input type="search" placeholder={searchPlaceholder} value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} aria-label="Search table" style={{ minWidth: 200 }} />
        )}
        {toolbar}
        <span className="count">{sorted.length.toLocaleString()} rows</span>
        <span style={{ flex: 1 }} />
        {csvName && <button className="btn sm" onClick={exportCsv}>↓ CSV</button>}
      </div>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    className={`${c.num ? 'num' : ''} ${sortable ? 'sortable' : ''}`}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                    title={c.title}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.label}{active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={columns.length} className="empty">{emptyText}</td></tr>
            )}
            {view.map((r) => {
              const k = rowKey(r)
              return (
                <tr
                  key={k}
                  className={`${onRowClick ? 'clickable' : ''} ${selectedKey === k ? 'selected' : ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r) } : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}`}>
                      {c.render ? c.render(r) : String(getVal(r, c) ?? '—')}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn sm" disabled={pg === 0} onClick={() => setPage(0)}>«</button>
          <button className="btn sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
          <span>Page {pg + 1} of {pages}</span>
          <button className="btn sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
          <button className="btn sm" disabled={pg >= pages - 1} onClick={() => setPage(pages - 1)}>»</button>
        </div>
      )}
    </div>
  )
}
