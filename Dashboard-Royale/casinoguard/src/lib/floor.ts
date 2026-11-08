/*
 * Slice-and-dice engine for the interactive views.
 *
 * Everything here is a ratio-of-sums over q1.json `machine_month` rows (one row per machine per month,
 * built by pipeline/build_data.py from prepared_daily_view). Nothing is estimated: a filter only chooses
 * which rows are summed. A machine-month row is attributed to the zone the machine stood in that month
 * (`zone_id` on the row) and to the machine's theme (q1.json `machines`).
 */
import type { MachineMonth, MachineStatic, Q1Data } from './types'

export interface Slice {
  months?: string[]
  zone?: string
  theme?: string
}

export interface Agg {
  rows: number
  machines: number
  coin_in: number
  theo: number
  house_win: number
  luck: number
  occupied_hours: number
  available_hours: number
  sched_hours: number
  faults: number
  repair_cost: number
  contribution: number
  spins: number
}

const EMPTY: Agg = {
  rows: 0, machines: 0, coin_in: 0, theo: 0, house_win: 0, luck: 0, occupied_hours: 0, available_hours: 0,
  sched_hours: 0, faults: 0, repair_cost: 0, contribution: 0, spins: 0,
}

export interface FloorIndex {
  rows: (MachineMonth & { theme: string; zone_name: string })[]
  machines: Map<string, MachineStatic>
  zones: { id: string; name: string }[]
  themes: string[]
  months: string[]
}

const cache = new WeakMap<Q1Data, FloorIndex>()

export function floorIndex(data: Q1Data): FloorIndex {
  const hit = cache.get(data)
  if (hit) return hit
  const machines = new Map(data.machines.map((m) => [m.machine_id, m]))
  const zoneNames = new Map<string, string>()
  data.machines.forEach((m) => { if (m.zone_id) zoneNames.set(m.zone_id, m.zone_name) })
  const rows = data.machine_month.map((r) => ({
    ...r,
    theme: machines.get(r.machine_id)?.theme ?? '—',
    zone_name: (r.zone_id && zoneNames.get(r.zone_id)) || '—',
  }))
  const idx: FloorIndex = {
    rows,
    machines,
    zones: [...zoneNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    themes: [...new Set(data.machines.map((m) => m.theme))].sort(),
    months: [...new Set(data.machine_month.map((r) => r.month))].sort(),
  }
  cache.set(data, idx)
  return idx
}

export function matches(r: FloorIndex['rows'][number], s: Slice) {
  return (!s.months || s.months.includes(r.month)) && (!s.zone || r.zone_id === s.zone) && (!s.theme || r.theme === s.theme)
}

export function aggregate(rows: FloorIndex['rows']): Agg {
  const out = { ...EMPTY }
  const ids = new Set<string>()
  for (const r of rows) {
    out.rows++
    out.coin_in += r.coin_in
    out.theo += r.theo
    out.house_win += r.house_win
    out.luck += r.luck
    out.occupied_hours += r.occupied_hours
    out.available_hours += r.available_hours
    out.sched_hours += r.sched_hours
    out.faults += r.faults
    out.repair_cost += r.repair_cost
    out.contribution += r.contribution
    out.spins += r.spins
    if (r.active_days > 0) ids.add(r.machine_id)
  }
  out.machines = ids.size
  return out
}

export function sliceAgg(idx: FloorIndex, s: Slice): Agg {
  return aggregate(idx.rows.filter((r) => matches(r, s)))
}

/** Group a slice by a dimension; the dimension's own filter is dropped so every group is shown. */
export function groupBy(idx: FloorIndex, s: Slice, dim: 'zone' | 'theme' | 'month'): { key: string; label: string; agg: Agg }[] {
  const base: Slice = { ...s, [dim === 'month' ? 'months' : dim]: undefined }
  const keys = dim === 'zone' ? idx.zones.map((z) => ({ key: z.id, label: z.name }))
    : dim === 'theme' ? idx.themes.map((t) => ({ key: t, label: t }))
      : (s.months ?? idx.months).map((m) => ({ key: m, label: m }))
  const months = dim === 'month' ? undefined : base.months
  return keys.map(({ key, label }) => {
    const sl: Slice = dim === 'month' ? { ...base, months: [key] } : { ...base, months, [dim]: key }
    return { key, label, agg: sliceAgg(idx, sl) }
  })
}

/** Per-machine totals within a slice (for top / bottom lists in investigation panels). */
export function machinesIn(idx: FloorIndex, s: Slice) {
  const by = new Map<string, FloorIndex['rows']>()
  idx.rows.filter((r) => matches(r, s)).forEach((r) => {
    const a = by.get(r.machine_id)
    if (a) a.push(r)
    else by.set(r.machine_id, [r])
  })
  return [...by].map(([id, rows]) => ({ machine_id: id, meta: idx.machines.get(id)!, agg: aggregate(rows) }))
    .filter((m) => m.agg.available_hours > 0)
}
