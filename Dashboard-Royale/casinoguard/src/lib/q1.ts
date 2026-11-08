import type { MachineMonth, MachineStatic, Q1Data } from './types'

export interface MachinePerf extends MachineStatic {
  observed_days: number
  active_days: number
  available_hours: number
  occupied_hours: number
  sched_hours: number
  coin_in: number
  theo: number
  house_win: number
  luck: number
  repair_cost: number
  faults: number
  contribution: number
  occupancy: number
  theo_per_hour: number
  win_per_hour: number
  availability: number
  theo_pctile: number
  occ_pctile: number
  score: number
  eligible: boolean
  rank: number | null
  period_zone: string | null
  period_bank: string | null
  zone_occupancy: number
  occ_vs_zone: number
  zone_rank: number | null
  zone_count: number
}

/** pandas Series.rank(pct=True) with method='average', NaN excluded. */
function pctRank(values: { id: string; v: number }[]): Map<string, number> {
  const valid = values.filter((x) => Number.isFinite(x.v)).sort((a, b) => a.v - b.v)
  const n = valid.length
  const out = new Map<string, number>()
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && valid[j + 1].v === valid[i].v) j++
    const avgRank = (i + 1 + j + 1) / 2
    for (let k = i; k <= j; k++) out.set(valid[k].id, avgRank / n)
    i = j + 1
  }
  return out
}

export const MIN_DAYS_FULL = 90

/** Minimum observed days for eligibility: 90 for the full half-year (team rule), scaled to half the window for shorter periods. */
export const minDaysFor = (periodDays: number) => Math.min(MIN_DAYS_FULL, Math.ceil(periodDays / 2))

/**
 * Re-implements finalize_bottom_10.py for an arbitrary set of months:
 *   score = 0.60 × (1 − theo/hr percentile) + 0.40 × (1 − occupancy percentile),
 *   percentiles computed within config_id; eligible = on-floor (active) days ≥ min & available hours > 0.
 *   Note: the team script counted calendar rows (incl. days before install / after retirement); using on-floor days
 *   additionally excludes M-5076 (49 days) and M-1118 (55 days) and leaves the full-period top 10 unchanged.
 */
export function scoreMachines(data: Q1Data, months: string[], periodDays: number): MachinePerf[] {
  const set = new Set(months)
  const byM = new Map<string, MachineMonth[]>()
  for (const r of data.machine_month) {
    if (!set.has(r.month)) continue
    const a = byM.get(r.machine_id)
    if (a) a.push(r)
    else byM.set(r.machine_id, [r])
  }
  const minDays = minDaysFor(periodDays)
  const perf: MachinePerf[] = []
  for (const m of data.machines) {
    const rows = byM.get(m.machine_id) ?? []
    const s = (k: keyof MachineMonth) => rows.reduce((a, r) => a + ((r[k] as number) || 0), 0)
    const available = s('available_hours')
    const occupied = s('occupied_hours')
    const theo = s('theo')
    const hw = s('house_win')
    // period location = month with most active days
    const best = [...rows].sort((a, b) => b.active_days - a.active_days)[0]
    perf.push({
      ...m,
      observed_days: s('days'),
      active_days: s('active_days'),
      available_hours: available,
      occupied_hours: occupied,
      sched_hours: s('sched_hours'),
      coin_in: s('coin_in'),
      theo,
      house_win: hw,
      luck: s('luck'),
      repair_cost: s('repair_cost'),
      faults: s('faults'),
      contribution: s('contribution'),
      occupancy: available > 0 ? occupied / available : NaN,
      theo_per_hour: available > 0 ? theo / available : NaN,
      win_per_hour: available > 0 ? hw / available : NaN,
      availability: s('sched_hours') > 0 ? available / s('sched_hours') : NaN,
      theo_pctile: NaN, occ_pctile: NaN, score: NaN, eligible: false, rank: null,
      period_zone: best?.zone_id ?? m.zone_id, period_bank: best?.bank_id ?? m.bank_id,
      zone_occupancy: NaN, occ_vs_zone: NaN, zone_rank: null, zone_count: 0,
    })
  }
  // percentiles within configuration
  const byCfg = new Map<string, MachinePerf[]>()
  perf.forEach((p) => { const a = byCfg.get(p.config_id); if (a) a.push(p); else byCfg.set(p.config_id, [p]) })
  for (const group of byCfg.values()) {
    const tp = pctRank(group.map((g) => ({ id: g.machine_id, v: g.theo_per_hour })))
    const op = pctRank(group.map((g) => ({ id: g.machine_id, v: g.occupancy })))
    for (const g of group) {
      g.theo_pctile = tp.get(g.machine_id) ?? NaN
      g.occ_pctile = op.get(g.machine_id) ?? NaN
      g.score = 0.6 * (1 - g.theo_pctile) + 0.4 * (1 - g.occ_pctile)
    }
  }
  // zone context (pooled occupancy, location-relative)
  const zoneAgg = new Map<string, { occ: number; av: number }>()
  perf.forEach((p) => {
    if (!p.period_zone) return
    const z = zoneAgg.get(p.period_zone) ?? { occ: 0, av: 0 }
    z.occ += p.occupied_hours; z.av += p.available_hours
    zoneAgg.set(p.period_zone, z)
  })
  perf.forEach((p) => {
    const z = p.period_zone ? zoneAgg.get(p.period_zone) : undefined
    p.zone_occupancy = z && z.av ? z.occ / z.av : NaN
    p.occ_vs_zone = p.occupancy / p.zone_occupancy
    p.eligible = p.active_days >= minDays && p.available_hours > 0 && Number.isFinite(p.score)
  })
  const elig = perf.filter((p) => p.eligible).sort((a, b) => b.score - a.score)
  elig.forEach((p, i) => { p.rank = i + 1 })
  // rank within zone (by the same score)
  const byZone = new Map<string, MachinePerf[]>()
  elig.forEach((p) => { const z = p.period_zone ?? '?'; const a = byZone.get(z); if (a) a.push(p); else byZone.set(z, [p]) })
  for (const g of byZone.values()) g.forEach((p, i) => { p.zone_rank = i + 1; p.zone_count = g.length })
  return perf
}
