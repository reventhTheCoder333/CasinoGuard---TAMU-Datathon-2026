import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import { useFilters } from '../lib/filters'
import { floorIndex, groupBy, machinesIn, sliceAgg, type Agg, type FloorIndex, type Slice } from '../lib/floor'
import { FLOOR_METRICS, metricDef, type MetricDef } from '../lib/metrics'
import { mLabel, signedPct } from '../lib/format'
import type { Q1Data } from '../lib/types'
import { Kpi, Loading, PageHead, Panel, Seg } from '../components/ui'
import { useInsight, type InsightSpec } from '../components/Insight'
import { axisProps, ChartTip, GOLD, gridProps, MUTED, SERIES, ZONE_COLORS } from '../components/chart'

const KPI_METRICS = ['coin_in', 'theo', 'hold', 'occupancy', 'theo_per_hour', 'faults']
type Dim = 'month' | 'zone' | 'theme'

const val = (m: MetricDef, a: Agg) => (m.value ? m.value(a) : NaN)
const delta = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? (b / a - 1) * 100 : NaN)

export default function Explorer() {
  const p = usePeriod()
  const f = useFilters()
  const insight = useInsight()
  const { data, error } = useData<Q1Data>('q1')
  const [focusState, setFocusMonth] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)

  const idx = useMemo(() => (data ? floorIndex(data) : null), [data])
  if (!idx) return <Loading error={error} />

  const metric = metricDef(f.metric)
  // The month focus only applies while that month is inside the selected period (e.g. during playback).
  const focusMonth = focusState && p.months.length > 1 && p.months.includes(focusState) ? focusState : null
  const months = focusMonth ? [focusMonth] : p.months
  const slice: Slice = { months, zone: f.zone || undefined, theme: f.theme || undefined }
  const agg = sliceAgg(idx, slice)
  const zoneName = (id: string) => idx.zones.find((z) => z.id === id)?.name ?? id
  const sliceLabel = [f.zone && zoneName(f.zone), f.theme, months.length === 1 ? `${mLabel(months[0])} 2025` : p.label].filter(Boolean).join(' · ')

  const byZone = groupBy(idx, slice, 'zone').filter((g) => g.agg.available_hours > 0)
  const byTheme = groupBy(idx, slice, 'theme').filter((g) => g.agg.available_hours > 0)
  const byMonth = groupBy(idx, { ...slice, months: p.months }, 'month')

  const machineRows = machinesIn(idx, slice)
    .map((m) => ({ ...m, v: val(metric, m.agg) }))
    .filter((m) => Number.isFinite(m.v))
    .sort((a, b) => (metric.lowerIsBetter ? a.v - b.v : b.v - a.v))

  const openSlice = (m: MetricDef, s: Slice, title: string, eyebrow: string, extra?: Partial<InsightSpec>) => {
    const a = sliceAgg(idx, s)
    const trend = groupBy(idx, { ...s, months: p.months }, 'month')
    const zones = groupBy(idx, s, 'zone').filter((g) => g.agg.available_hours > 0)
      .sort((x, y) => val(m, y.agg) - val(m, x.agg))
    insight.open({
      eyebrow,
      title,
      subtitle: `${a.machines} machines · ${s.months?.length === 1 ? mLabel(s.months[0]) + ' 2025' : p.label}`,
      metricId: m.id,
      kpis: [
        { label: m.label, value: m.fmt(val(m, a)) },
        { label: 'Coin-in', value: metricDef('coin_in').fmt(a.coin_in) },
        { label: 'Occupancy', value: metricDef('occupancy').fmt(val(metricDef('occupancy'), a)) },
        { label: 'Theo / avail hr', value: metricDef('theo_per_hour').fmt(val(metricDef('theo_per_hour'), a)) },
      ],
      series: {
        title: `${m.label} by month`,
        points: trend.map((t) => ({ label: mLabel(t.key), value: val(m, t.agg), highlight: s.months?.length === 1 && s.months[0] === t.key })).filter((x) => Number.isFinite(x.value)),
        fmt: m.fmt, axis: m.axis,
      },
      table: {
        title: `${m.label} by zone`,
        columns: ['Zone', 'Machines', m.label],
        numeric: [false, true, true],
        rows: zones.map((z) => [z.label, String(z.agg.machines), m.fmt(val(m, z.agg))]),
      },
      ...extra,
    })
  }

  const openMachine = (row: (typeof machineRows)[number]) => {
    const trend = groupBy(idx, { months: p.months, zone: undefined, theme: undefined }, 'month').map((t) => {
      const r = idx.rows.filter((x) => x.machine_id === row.machine_id && x.month === t.key)
      return { label: mLabel(t.key), value: r.length ? val(metric, sumRows(r)) : NaN, highlight: months.length === 1 && months[0] === t.key }
    }).filter((x) => Number.isFinite(x.value))
    insight.open({
      eyebrow: 'Machine',
      title: `${row.machine_id} · ${row.meta.theme}`,
      subtitle: `${row.meta.manufacturer} · ${row.meta.config_id} · ${zoneName(row.meta.zone_id)} · ${row.meta.volatility} volatility`,
      metricId: metric.id,
      kpis: ['coin_in', 'theo_per_hour', 'occupancy', 'faults'].map((id) => ({ label: metricDef(id).label, value: metricDef(id).fmt(val(metricDef(id), row.agg)) })),
      series: { title: `${metric.label} by month`, points: trend, fmt: metric.fmt, axis: metric.axis },
      note: <>Totals over {sliceLabel}. Configured RTP {(row.meta.configured_rtp * 100).toFixed(2)}%, lease class {row.meta.lease_class}.</>,
      actions: [{ label: 'Open Q1 machine ranking', to: '/q1' }, { label: 'Open Q3 maintenance', to: '/q3' }],
    })
  }

  return (
    <div>
      <PageHead eyebrow="Interactive explorer" title="Slice the floor by month, zone and theme"
        question="Click any bar to cross-filter every chart and KPI on this page. Click a KPI or machine to investigate it. All figures are sums over the real machine-month records."
        right={<button className={`btn ${compare ? 'gold' : ''}`} onClick={() => setCompare((c) => !c)} aria-pressed={compare}>⇄ Comparison mode</button>} />

      <div className="chips" aria-label="Active filters">
        <span className="chip static">{p.label}</span>
        {focusMonth && <button className="chip" onClick={() => setFocusMonth(null)}>Month: {mLabel(focusMonth)} <span aria-hidden="true">✕</span></button>}
        {f.zone && <button className="chip" onClick={() => f.setZone('')}>Zone: {zoneName(f.zone)} <span aria-hidden="true">✕</span></button>}
        {f.theme && <button className="chip" onClick={() => f.setTheme('')}>Theme: {f.theme} <span aria-hidden="true">✕</span></button>}
        {!focusMonth && !f.zone && !f.theme && <span className="chip-hint">No cross-filters · click a bar below</span>}
        {(focusMonth || f.zone || f.theme) && <button className="btn sm" onClick={() => { setFocusMonth(null); f.clear() }}>Clear all</button>}
      </div>

      {agg.available_hours === 0 ? (
        <div className="empty panel mt">No machine play matches these filters. Clear a filter to see results.</div>
      ) : (
        <>
          <div className="kpis mt">
            {KPI_METRICS.map((id) => {
              const m = metricDef(id)
              return (
                <Kpi key={id} label={m.label} value={m.fmt(val(m, agg))} metric={id} active={f.metric === id}
                  sub={sliceLabel}
                  onOpen={() => openSlice(m, slice, `${m.label}: ${sliceLabel}`, 'KPI investigation', {
                    actions: [{ label: `Chart ${m.label.toLowerCase()}`, onClick: () => f.setMetric(id), primary: true }],
                  })} />
              )
            })}
          </div>

          {compare && <Comparison idx={idx} metric={metric} />}

          <div className="grid g2 mt">
            <Panel title={`${metric.label} by zone`} sub={`${f.zone ? 'Click the selected zone again to clear' : 'Click a zone to filter'} · ${sliceLabel.replace(f.zone ? zoneName(f.zone) + ' · ' : '', '')}`}
              actions={<>
                <button className="btn sm" onClick={() => insight.explain(metric.id)}>ƒ Formula</button>
                {f.zone && <button className="btn sm gold" onClick={() => openSlice(metric, slice, zoneName(f.zone), 'Zone investigation', { actions: [{ label: 'Open Q2 floor demand', to: '/q2' }] })}>Investigate zone</button>}
              </>}>
              <DimBars rows={byZone.map((g) => ({ key: g.key, label: g.label, value: val(metric, g.agg), color: ZONE_COLORS[g.key] }))}
                selected={f.zone} onPick={f.toggleZone} metric={metric} />
            </Panel>
            <Panel title={`${metric.label} by theme`} sub={`${f.theme ? 'Click the selected theme again to clear' : 'Click a theme to filter'}`}
              actions={<>
                <button className="btn sm" onClick={() => insight.explain(metric.id)}>ƒ Formula</button>
                {f.theme && <button className="btn sm gold" onClick={() => openSlice(metric, slice, f.theme, 'Theme investigation', { actions: [{ label: 'Open Q2 themes', to: '/q2' }] })}>Investigate theme</button>}
              </>}>
              <DimBars rows={byTheme.map((g) => ({ key: g.key, label: g.label, value: val(metric, g.agg) }))}
                selected={f.theme} onPick={f.toggleTheme} metric={metric} />
            </Panel>
          </div>

          <div className="grid g-21 mt">
            <Panel title={`${metric.label} by month`} sub={focusMonth ? `Focused on ${mLabel(focusMonth)} · click it again to clear` : 'Click a month to focus every chart on it'}
              actions={<button className="btn sm" onClick={() => insight.explain(metric.id)}>ƒ Formula</button>}>
              {byMonth.length < 2 && !focusMonth ? <div className="empty">Choose two or more months, or use playback above.</div> : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={byMonth.map((g) => ({ key: g.key, label: mLabel(g.key), value: val(metric, g.agg) }))} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="label" {...axisProps} />
                      <YAxis {...axisProps} width={62} tickFormatter={metric.axis ?? metric.fmt} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => metric.fmt(v)} labelFmt={(l) => `${l} 2025`} />} />
                      <Bar dataKey="value" name={metric.label} radius={[5, 5, 0, 0]} cursor="pointer" isAnimationActive
                        onClick={(d) => { const k = (d as unknown as { key: string }).key; setFocusMonth((cur) => (cur === k ? null : k)) }}>
                        {byMonth.map((g) => <Cell key={g.key} fill={focusMonth === g.key ? GOLD : focusMonth ? MUTED : SERIES[0]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title={metric.lowerIsBetter ? `Fewest ${metric.label.toLowerCase()}` : `Top machines by ${metric.label.toLowerCase()}`}
              sub={`${machineRows.length} machines in this slice · click one to investigate`}>
              <div className="table-wrap">
                <table className="dt">
                  <thead><tr><th>Machine</th><th>Theme</th><th className="num">{metric.label}</th></tr></thead>
                  <tbody>
                    {machineRows.slice(0, 8).map((m) => (
                      <tr key={m.machine_id} className="clickable" onClick={() => openMachine(m)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openMachine(m) }}>
                        <td className="strong">{m.machine_id}</td><td>{m.meta.theme}</td><td className="num">{metric.fmt(m.v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {machineRows.length > 8 && (
                <p className="small muted mt-s">
                  Bottom of the slice: {machineRows.slice(-3).reverse().map((m, i) => (
                    <span key={m.machine_id}>{i > 0 && ', '}<button className="link-btn" onClick={() => openMachine(m)}>{m.machine_id}</button> ({metric.fmt(m.v)})</span>
                  ))}
                </p>
              )}
            </Panel>
          </div>
        </>
      )}

      <p className="small muted mt">
        Source: <code>q1.json</code> machine_month, built by <code>pipeline/build_data.py</code> from <code>prepared_daily_view</code>. A machine-month counts toward the zone the machine stood in that month.
        Zone-month totals can differ slightly from the Q2 page, which assigns each machine-day separately. Synthetic data for a fictional casino.
      </p>
    </div>
  )
}

function sumRows(rows: FloorIndex['rows']): Agg {
  return rows.reduce<Agg>((a, r) => ({
    rows: a.rows + 1, machines: 1, coin_in: a.coin_in + r.coin_in, theo: a.theo + r.theo, house_win: a.house_win + r.house_win, luck: a.luck + r.luck,
    occupied_hours: a.occupied_hours + r.occupied_hours, available_hours: a.available_hours + r.available_hours, sched_hours: a.sched_hours + r.sched_hours,
    faults: a.faults + r.faults, repair_cost: a.repair_cost + r.repair_cost, contribution: a.contribution + r.contribution, spins: a.spins + r.spins,
  }), { rows: 0, machines: 0, coin_in: 0, theo: 0, house_win: 0, luck: 0, occupied_hours: 0, available_hours: 0, sched_hours: 0, faults: 0, repair_cost: 0, contribution: 0, spins: 0 })
}

/** Horizontal bars; clicking one toggles it as a global filter (cross-filtering). */
function DimBars({ rows, selected, onPick, metric }: {
  rows: { key: string; label: string; value: number; color?: string }[]
  selected: string; onPick: (k: string) => void; metric: MetricDef
}) {
  const valid = rows.filter((r) => Number.isFinite(r.value)).sort((a, b) => b.value - a.value)
  const max = Math.max(...valid.map((r) => Math.abs(r.value)), 0) || 1
  if (!valid.length) return <div className="empty">No data for this slice.</div>
  return (
    <div className="dimbars" role="list">
      {valid.map((r) => (
        <button key={r.key} role="listitem" className={`dimbar ${selected === r.key ? 'on' : ''} ${selected && selected !== r.key ? 'dim' : ''}`}
          onClick={() => onPick(r.key)} aria-pressed={selected === r.key} title={`Filter to ${r.label}`}>
          <span className="dimbar-label">{r.color && <span className="status-dot" style={{ background: r.color }} />}{r.label}</span>
          <span className="dimbar-track"><span className="dimbar-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></span>
          <span className="dimbar-value">{metric.fmt(r.value)}</span>
        </button>
      ))}
    </div>
  )
}

/** Side-by-side comparison of two months, zones or themes, honouring the other global filters. */
function Comparison({ idx, metric }: { idx: FloorIndex; metric: MetricDef }) {
  const p = usePeriod()
  const f = useFilters()
  const [dim, setDim] = useState<Dim>('zone')
  const options = dim === 'month' ? idx.months.map((m) => ({ value: m, label: `${mLabel(m)} 2025` }))
    : dim === 'zone' ? idx.zones.map((z) => ({ value: z.id, label: z.name }))
      : idx.themes.map((t) => ({ value: t, label: t }))
  const [picks, setPicks] = useState<Record<Dim, [string, string]>>({
    month: [idx.months[0], idx.months[idx.months.length - 1]],
    zone: [idx.zones[0]?.id ?? '', idx.zones[1]?.id ?? ''],
    theme: [idx.themes[0] ?? '', idx.themes[1] ?? ''],
  })
  const [a, b] = picks[dim]
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v

  const sliceFor = (v: string): Slice => dim === 'month'
    ? { months: [v], zone: f.zone || undefined, theme: f.theme || undefined }
    : { months: p.months, zone: dim === 'zone' ? v : f.zone || undefined, theme: dim === 'theme' ? v : f.theme || undefined }
  const A = sliceAgg(idx, sliceFor(a))
  const B = sliceAgg(idx, sliceFor(b))
  const context = [dim !== 'zone' && f.zone && idx.zones.find((z) => z.id === f.zone)?.name, dim !== 'theme' && f.theme, dim !== 'month' && p.label].filter(Boolean).join(' · ')

  // Trend: both sides month by month (zones/themes), or by zone (months).
  const trend = dim === 'month'
    ? idx.zones.map((z) => ({
      label: z.name,
      A: val(metric, sliceAgg(idx, { ...sliceFor(a), zone: z.id })),
      B: val(metric, sliceAgg(idx, { ...sliceFor(b), zone: z.id })),
    }))
    : p.months.map((m) => ({
      label: mLabel(m),
      A: val(metric, sliceAgg(idx, { ...sliceFor(a), months: [m] })),
      B: val(metric, sliceAgg(idx, { ...sliceFor(b), months: [m] })),
    }))
  const clean = trend.map((t) => ({ ...t, A: Number.isFinite(t.A) ? t.A : null, B: Number.isFinite(t.B) ? t.B : null }))

  return (
    <Panel className="mt compare" title="Comparison mode" sub={context ? `Within ${context}` : 'Whole floor'}
      actions={<Seg value={dim} onChange={setDim} label="Compare" options={[{ value: 'month', label: 'Months' }, { value: 'zone', label: 'Zones' }, { value: 'theme', label: 'Themes' }]} />}>
      <div className="compare-picks">
        {(['A', 'B'] as const).map((side, i) => (
          <label key={side} className={`compare-pick side-${side}`}>
            <span>{side}</span>
            <select value={picks[dim][i]} aria-label={`Comparison ${side}`}
              onChange={(e) => setPicks((pk) => { const n = [...pk[dim]] as [string, string]; n[i] = e.target.value; return { ...pk, [dim]: n } })}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <button className="btn sm" onClick={() => setPicks((pk) => ({ ...pk, [dim]: [b, a] }))} aria-label="Swap A and B">⇄ Swap</button>
      </div>

      <div className="grid g2">
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Metric</th><th className="num">A · {label(a)}</th><th className="num">B · {label(b)}</th><th className="num">B vs A</th></tr></thead>
            <tbody>
              {FLOOR_METRICS.map((m) => {
                const va = val(m, A), vb = val(m, B), d = delta(va, vb)
                const good = m.lowerIsBetter ? d < 0 : d > 0
                return (
                  <tr key={m.id} className={m.id === metric.id ? 'row-on' : ''}>
                    <td>{m.label}</td><td className="num">{m.fmt(va)}</td><td className="num">{m.fmt(vb)}</td>
                    <td className={`num ${!Number.isFinite(d) || Math.abs(d) < 0.05 || m.id === 'luck' ? 'muted' : good ? 'pos' : 'neg'}`}>{Number.isFinite(d) ? signedPct(d, 1) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="small muted mt-s">{A.machines} machines in A, {B.machines} in B. Relative change; for luck, a sign change makes the percentage less meaningful.</p>
        </div>
        <div>
          <div className="small secondary" style={{ marginBottom: 6 }}>{metric.label} · {dim === 'month' ? 'by zone' : 'by month'}</div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              {dim === 'month' ? (
                <BarChart data={clean} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval={0} angle={-20} textAnchor="end" height={50} tick={{ ...axisProps.tick, fontSize: 10 }} />
                  <YAxis {...axisProps} width={62} tickFormatter={metric.axis ?? metric.fmt} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => metric.fmt(v)} />} />
                  <RLegend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="A" name={`A · ${label(a)}`} fill={SERIES[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="B" name={`B · ${label(b)}`} fill={GOLD} radius={[4, 4, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={clean} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} width={62} tickFormatter={metric.axis ?? metric.fmt} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTip fmt={(v) => metric.fmt(v)} />} />
                  <RLegend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey="A" name={`A · ${label(a)}`} stroke={SERIES[0]} strokeWidth={2.2} dot={{ r: 3 }} connectNulls={false} />
                  <Line dataKey="B" name={`B · ${label(b)}`} stroke={GOLD} strokeWidth={2.2} dot={{ r: 3 }} connectNulls={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Panel>
  )
}
