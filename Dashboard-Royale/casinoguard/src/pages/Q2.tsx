import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import { useFilters } from '../lib/filters'
import type { Q2Data, ZoneMonth } from '../lib/types'
import { dLabel, mLabel, num, pct, signedPct, usd, usdShort } from '../lib/format'
import { Callout, Legend, Loading, PageHead, Panel, Seg, Select } from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { axisProps, ChartTip, GOLD, gridProps, SERIES, ZONE_COLORS } from '../components/chart'

type MetricKey = 'daily_coin' | 'occupancy' | 'cph' | 'eph' | 'daily_theo'
const METRICS: Record<MetricKey, { label: string; fmt: (v: number) => string; axis: (v: number) => string; tip: string }> = {
  daily_coin: { label: 'Daily coin-in', fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0), tip: 'Σ coin_in_usd ÷ gaming days in month (active machines only)' },
  occupancy: { label: 'Occupancy', fmt: (v) => `${v.toFixed(2)}%`, axis: (v) => `${v.toFixed(0)}%`, tip: 'Σ occupied_hours ÷ Σ available_hours' },
  cph: { label: 'Coin-in / available hr', fmt: (v) => usd(v), axis: (v) => `$${v.toFixed(0)}`, tip: 'Σ coin_in_usd ÷ Σ available_hours — demand per unit of exposure' },
  eph: { label: 'Entries / counter hr', fmt: (v) => v.toFixed(1), axis: (v) => v.toFixed(0), tip: 'Σ entries_count ÷ Σ coverage hours (offline counters excluded; entries ≠ unique visitors)' },
  daily_theo: { label: 'Daily theo win', fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0), tip: 'Σ theo_usd ÷ gaming days' },
}
function metric(z: Pick<ZoneMonth, 'coin_in' | 'days' | 'occupied_hours' | 'available_hours' | 'theo'> & { entries?: number | null; coverage_hours?: number | null }, k: MetricKey): number | null {
  switch (k) {
    case 'daily_coin': return z.coin_in / z.days
    case 'occupancy': return (z.occupied_hours / z.available_hours) * 100
    case 'cph': return z.coin_in / z.available_hours
    case 'eph': return z.entries && z.coverage_hours ? z.entries / z.coverage_hours : null
    case 'daily_theo': return z.theo / z.days
  }
}
// Global metric ids that have a Q2 equivalent, and back.
const FROM_GLOBAL: Record<string, MetricKey> = { coin_in: 'daily_coin', occupancy: 'occupancy', coin_per_hour: 'cph', theo: 'daily_theo' }
const TO_GLOBAL: Partial<Record<MetricKey, string>> = { daily_coin: 'coin_in', occupancy: 'occupancy', cph: 'coin_per_hour', daily_theo: 'theo' }
const DEFAULT_ZONE = 'Z-B40'
const chg = (a: number | null, b: number | null) => (a && b !== null ? (b / a - 1) * 100 : null)

export default function Q2() {
  const p = usePeriod()
  const { data, error } = useData<Q2Data>('q2')
  // Zone, theme and metric follow the global filters so this page cross-filters with the others.
  const f = useFilters()
  const [override, setOverride] = useState<MetricKey | null>(null)
  useEffect(() => { setOverride(null) }, [f.metric])
  const m: MetricKey = override ?? FROM_GLOBAL[f.metric] ?? 'daily_coin'
  const setM = (k: MetricKey) => { const g = TO_GLOBAL[k]; if (g) { f.setMetric(g); setOverride(null) } else setOverride(k) }
  const zone = f.zone || DEFAULT_ZONE
  const setZone = f.setZone
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const theme = f.theme
  const setTheme = f.setTheme

  const zn = useMemo(() => Object.fromEntries((data?.zones ?? []).map((z) => [z.zone_id, z.zone_name])), [data])

  if (!data) return <Loading error={error} />
  const months = p.months
  const first = months[0], last = months[months.length - 1]
  const single = months.length < 2

  const zm = data.zone_month.filter((z) => months.includes(z.month))
  const chartData = months.map((mo) => {
    const row: Record<string, number | string | null> = { month: mo }
    data.zones.forEach((z) => { const r = zm.find((x) => x.month === mo && x.zone_id === z.zone_id); row[z.zone_id] = r ? metric(r, m) : null })
    return row
  })

  const cmp = data.zones.map((z) => {
    const a = data.zone_month.find((x) => x.zone_id === z.zone_id && x.month === first)!
    const b = data.zone_month.find((x) => x.zone_id === z.zone_id && x.month === last)!
    const o: Record<string, string | number | null> = { zone_id: z.zone_id, zone_name: z.zone_name, corr: data.traffic_demand_corr[z.zone_id] }
    ;(['daily_coin', 'occupancy', 'cph', 'eph'] as MetricKey[]).forEach((k) => { o[`${k}_a`] = metric(a, k); o[`${k}_b`] = metric(b, k); o[`${k}_chg`] = chg(metric(a, k), metric(b, k)) })
    o.cpo_chg = chg(a.coin_in / a.occupied_hours, b.coin_in / b.occupied_hours)
    return o
  })
  // floor totals
  const floor = (mo: string) => {
    const rows = data.zone_month.filter((x) => x.month === mo)
    const s = (k: keyof ZoneMonth) => rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0)
    return { coin_in: s('coin_in'), days: rows[0]?.days ?? 1, occupied_hours: s('occupied_hours'), available_hours: s('available_hours'), theo: s('theo'), entries: s('entries'), coverage_hours: s('coverage_hours') }
  }
  const fA = floor(first), fB = floor(last)

  const cmpCols: Column<Record<string, string | number | null>>[] = [
    { key: 'zone_name', label: 'Zone', render: (r) => <span className="row" style={{ gap: 6 }}><span className="status-dot" style={{ background: ZONE_COLORS[String(r.zone_id)] }} /><span className={r.zone_id === zone ? 'strong' : ''}>{String(r.zone_name)}</span></span> },
    { key: 'daily_coin_a', label: `Daily coin-in ${mLabel(first)}`, num: true, render: (r) => usd(r.daily_coin_a as number, 0) },
    { key: 'daily_coin_b', label: `${mLabel(last)}`, num: true, render: (r) => usd(r.daily_coin_b as number, 0) },
    { key: 'daily_coin_chg', label: 'Δ coin-in', num: true, render: (r) => <Delta v={r.daily_coin_chg as number} /> },
    { key: 'occupancy_chg', label: 'Δ occupancy', num: true, title: 'Relative change in occupancy rate', render: (r) => <Delta v={r.occupancy_chg as number} /> },
    { key: 'cph_chg', label: 'Δ coin-in/avail hr', num: true, render: (r) => <Delta v={r.cph_chg as number} /> },
    { key: 'eph_a', label: `Entries/hr ${mLabel(first)}`, num: true, render: (r) => num(r.eph_a as number, 1) },
    { key: 'eph_b', label: `${mLabel(last)}`, num: true, render: (r) => num(r.eph_b as number, 1) },
    { key: 'eph_chg', label: 'Δ traffic', num: true, render: (r) => <Delta v={r.eph_chg as number} /> },
    { key: 'corr', label: 'Traffic↔coin-in r', num: true, title: 'Pearson correlation of daily entries per counter-hour and daily coin-in, full Jan–Jun', render: (r) => (r.corr as number).toFixed(3) },
  ]

  // Zone drill-down
  const zdRaw = (data.zone_daily[zone] ?? []).filter(([d]) => p.inRange(d))
  const zd = zdRaw.map(([d, c, o, a, e, cm]) => ({ d, coin: c, occ: a ? (o / a) * 100 : null, eph: e !== null && cm ? e / (cm / 60) : null }))
  const events = data.events.filter((e) => e.end_date >= p.start && e.start_date <= p.end)
  const banks = [...new Set(data.bank_month.filter((b) => b.zone_id === zone).map((b) => b.bank_id))].sort()
  const bankRows = banks.map((b) => {
    const a = data.bank_month.find((x) => x.bank_id === b && x.month === first)
    const bb = data.bank_month.find((x) => x.bank_id === b && x.month === last)
    const inP = data.bank_month.filter((x) => x.bank_id === b && months.includes(x.month))
    const av = inP.reduce((s, x) => s + x.available_hours, 0)
    return {
      bank_id: b, machines: bb?.machines ?? a?.machines ?? 0,
      occ: inP.reduce((s, x) => s + x.occupied_hours, 0) / av, cph: inP.reduce((s, x) => s + x.coin_in, 0) / av,
      chg: a && bb ? ((bb.coin_in / bb.days) / (a.coin_in / a.days) - 1) * 100 : null,
    }
  })
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const z = data.hourly_by_zone.find((x) => x.local_hour === h && x.zone_id === zone)
    const all = data.hourly_by_zone.filter((x) => x.local_hour === h)
    const fl = all.reduce((s, x) => s + x.occupied_hours, 0) / all.reduce((s, x) => s + x.available_hours, 0)
    return { h, zone: z ? z.occupancy_rate * 100 : null, floor: fl * 100 }
  })

  // Themes
  const themes = [...new Set(data.theme_month.map((t) => t.theme))].sort()
  const themeRows = themes.map((t) => {
    const a = data.theme_month.find((x) => x.theme === t && x.month === first)
    const b = data.theme_month.find((x) => x.theme === t && x.month === last)
    const inP = data.theme_month.filter((x) => x.theme === t && months.includes(x.month))
    const av = inP.reduce((s, x) => s + x.available_hours, 0)
    return {
      theme: t, machines: Math.max(...inP.map((x) => x.machines), 0),
      occ: av ? inP.reduce((s, x) => s + x.occupied_hours, 0) / av : NaN, cph: av ? inP.reduce((s, x) => s + x.coin_in, 0) / av : NaN,
      chg: a && b && a.available_hours > 0 && b.available_hours > 0 ? ((b.coin_in / b.available_hours) / (a.coin_in / a.available_hours) - 1) * 100 : null,
      note: !a || a.available_hours === 0 ? `no play in ${mLabel(first)}` : '',
    }
  })
  const themeZone = theme ? data.zones.map((z) => {
    const inP = data.theme_zone_month.filter((x) => x.theme === theme && x.zone_id === z.zone_id && months.includes(x.month))
    const av = inP.reduce((s, x) => s + x.available_hours, 0)
    return { zone: z.zone_name, zone_id: z.zone_id, av, cph: av ? inP.reduce((s, x) => s + x.coin_in, 0) / av : null, occ: av ? inP.reduce((s, x) => s + x.occupied_hours, 0) / av : null }
  }).filter((x) => x.av > 0) : []

  const selCmp = cmp.find((c) => c.zone_id === zone)!
  const mostDown = [...cmp].sort((a, b) => (a.daily_coin_chg as number) - (b.daily_coin_chg as number))[0]
  const city = data.city_monthly.filter((c) => months.includes(String(c.month)))

  return (
    <div>
      <PageHead eyebrow="Q2 · Floor demand intelligence" title="How did player demand change across the floor, and why?"
        question="Monthly demand by zone, bank and theme from machine meters (all play), paired with door/zone traffic counters and the event calendar." />

      <Callout title="Analysis status: results validated against the team's Q2 outputs" tone="gold">
        Zone-level figures are recomputed from <code>prepared_daily_view</code> and <code>zone_traffic_hourly</code>; January and June daily coin-in for all 7 zones match <code>analysis/q2_floor_demand/outputs/zone_demand_change.csv</code> (14 checks).
        Comparisons use the <b>first vs last month of the selected period</b> ({mLabel(first)} → {mLabel(last)}). Explanations below state what the data is <i>consistent with</i>; correlation is not proof of cause.
      </Callout>

      <div className="filters mt">
        <span className="ctrl">Metric</span>
        <Seg value={m} onChange={setM} label="Metric" options={(Object.keys(METRICS) as MetricKey[]).map((k) => ({ value: k, label: METRICS[k].label }))} />
        <Select label="Drill into zone" value={zone} onChange={setZone} options={data.zones.map((z) => ({ value: z.zone_id, label: z.zone_name }))} />
        <Select label="Theme" value={theme} onChange={setTheme} allLabel="All themes" options={themes.map((t) => ({ value: t, label: t }))} />
        {(hidden.size > 0 || theme || f.zone || m !== 'daily_coin') && <button className="btn sm" onClick={() => { setHidden(new Set()); setTheme(''); setZone(''); setM('daily_coin') }}>Reset filters</button>}
      </div>

      <div className="grid g-21">
        <Panel title={`${METRICS[m].label} by zone, monthly`} sub={`${p.label} · click legend to hide zones · ${METRICS[m].tip}`}
          source={{ tables: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly'], fields: ['coin_in_usd', 'occupied_hours', 'available_hours', 'theo_usd', 'zone_id', 'entries_count', 'coverage_minutes', 'counter_status'], calc: METRICS[m].tip, note: 'Only active machine-days (machine on the floor). Traffic hours with counter_status = offline are excluded; partial hours use their coverage minutes.' }}>
          <Legend items={data.zones.map((z) => ({ key: z.zone_id, label: z.zone_name, color: ZONE_COLORS[z.zone_id], line: true }))} hidden={hidden}
            onToggle={(k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })} />
          {single ? <div className="empty">Select at least two months to see a monthly trend.</div> : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                  <YAxis {...axisProps} tickFormatter={METRICS[m].axis} width={58} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTip fmt={(v) => METRICS[m].fmt(v)} labelFmt={(l) => `${mLabel(String(l))} 2025`} />} />
                  {data.zones.filter((z) => !hidden.has(z.zone_id)).map((z) => (
                    <Line key={z.zone_id} dataKey={z.zone_id} name={z.zone_name} stroke={ZONE_COLORS[z.zone_id]} strokeWidth={z.zone_id === zone ? 3 : 1.6}
                      strokeOpacity={z.zone_id === zone ? 1 : 0.7} dot={{ r: z.zone_id === zone ? 4 : 2.5 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="What changed" sub={`${mLabel(first)} → ${mLabel(last)} · whole floor and largest mover`}>
          {single ? <div className="empty">Choose a period of two or more months.</div> : (
            <div className="stack" style={{ gap: 10 }}>
              <dl className="kv">
                <dt>Floor daily coin-in</dt><dd>{usd(fA.coin_in / fA.days, 0)} → {usd(fB.coin_in / fB.days, 0)} <Delta v={chg(fA.coin_in / fA.days, fB.coin_in / fB.days)} /></dd>
                <dt>Floor occupancy</dt><dd>{pct(fA.occupied_hours / fA.available_hours, 1)} → {pct(fB.occupied_hours / fB.available_hours, 1)}</dd>
                <dt>Floor entries / counter hr</dt><dd>{num(fA.entries / fA.coverage_hours, 1)} → {num(fB.entries / fB.coverage_hours, 1)} <Delta v={chg(fA.entries / fA.coverage_hours, fB.entries / fB.coverage_hours)} /></dd>
              </dl>
              <div className="callout">
                <div className="callout-title">Largest decline: {String(mostDown.zone_name)}</div>
                Daily coin-in <Delta v={mostDown.daily_coin_chg as number} />, traffic per counter-hour <Delta v={mostDown.eph_chg as number} />, occupancy <Delta v={mostDown.occupancy_chg as number} />.
                {' '}{interpret(mostDown)}
                Alternative tested: weekday mix — months are compared per gaming day. Note daily traffic and coin-in are strongly correlated in every zone (r ≥ {Math.min(...Object.values(data.traffic_demand_corr)).toFixed(2)}), partly because both follow the same weekly cycle.
              </div>
              {city.length > 0 && (
                <div className="small muted">
                  Las Vegas visitor volume (LVCVA, real): {num(Number(city[0].visitor_volume))} in {mLabel(first)} → {num(Number(city[city.length - 1].visitor_volume))} in {mLabel(last)}. City-wide context only — not this casino's guests.
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt" title={`Zone comparison: ${mLabel(first)} vs ${mLabel(last)}`} sub="Click a zone to drill down. Δ = relative change."
        source={{ tables: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly'], script: 'pipeline/build_data.py (Q2) · cross-checked with analysis/q2_floor_demand/outputs/q2_zone_traffic_jan_june_comparison.csv' }}>
        <DataTable rows={cmp} columns={cmpCols} rowKey={(r) => String(r.zone_id)} onRowClick={(r) => setZone(String(r.zone_id))} selectedKey={zone}
          initialSort={{ key: 'daily_coin_chg', dir: 'asc' }} csvName={`q2_zone_comparison_${p.key}`} pageSize={10} />
      </Panel>

      <h2 className="mt" style={{ marginTop: 26, marginBottom: 10 }}>Drill-down · <span style={{ color: ZONE_COLORS[zone] }}>{zn[zone]}</span></h2>
      <div className="grid g2">
        <Panel title="Daily coin-in" sub={`${zn[zone]} · ${p.label} · shaded = events`} source={{ tables: ['1_prepared_views/prepared_daily_view', '4_context/events'], fields: ['coin_in_usd'] }}>
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <ComposedChart data={zd} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                {events.map((e) => <ReferenceArea key={e.event_id} x1={e.start_date < p.start ? p.start : e.start_date} x2={e.end_date > p.end ? p.end : e.end_date} fill="#fff" fillOpacity={0.05} stroke="none" />)}
                <XAxis dataKey="d" {...axisProps} tickFormatter={dLabel} minTickGap={40} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 0)} width={52} />
                <Tooltip content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l) => dLabel(String(l))} />} />
                <Line dataKey="coin" name="Coin-in" stroke={ZONE_COLORS[zone]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Daily foot traffic" sub={`Entries per counter-hour · r = ${data.traffic_demand_corr[zone].toFixed(3)} with coin-in`} tip="Entries count crossings, not unique visitors; seated players are not counted. Offline hours excluded."
          source={{ tables: ['4_context/zone_traffic_hourly'], fields: ['entries_count', 'coverage_minutes', 'counter_status'] }}>
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <ComposedChart data={zd} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                {events.map((e) => <ReferenceArea key={e.event_id} x1={e.start_date < p.start ? p.start : e.start_date} x2={e.end_date > p.end ? p.end : e.end_date} fill="#fff" fillOpacity={0.05} stroke="none" />)}
                <XAxis dataKey="d" {...axisProps} tickFormatter={dLabel} minTickGap={40} />
                <YAxis {...axisProps} width={40} />
                <Tooltip content={<ChartTip fmt={(v) => v.toFixed(1)} labelFmt={(l) => dLabel(String(l))} />} />
                <Line dataKey="eph" name="Entries / counter hr" stroke={GOLD} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Banks in this zone" sub={`${p.label} · Δ daily coin-in ${mLabel(first)}→${mLabel(last)}`} source={{ tables: ['1_prepared_views/prepared_daily_view'], fields: ['bank_id', 'coin_in_usd', 'occupied_hours', 'available_hours'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Bank</th><th className="num">Machines</th><th className="num">Occupancy</th><th className="num">Coin-in / avail hr</th><th className="num">Δ daily coin-in</th></tr></thead>
            <tbody>{bankRows.map((b) => <tr key={b.bank_id}><td className="strong">{b.bank_id}</td><td className="num">{b.machines}</td><td className="num">{pct(b.occ, 1)}</td><td className="num">{usd(b.cph)}</td><td className="num"><Delta v={single ? null : b.chg} /></td></tr>)}</tbody></table></div>
        </Panel>
        <Panel title="Hour-of-day occupancy" sub={`${zn[zone]} vs whole floor · Jan–Jun (from machine_hour)`} tip="Hourly profile computed by the team's q2_time_analysis.py from machine_hour; shown for the full half-year."
          source={{ tables: ['5_optional/machine_hour'], script: 'q2_time_analysis.py → analysis/q2_floor_demand/outputs/q2_hourly_demand_by_zone.csv' }}>
          <Legend items={[{ key: 'z', label: zn[zone], color: ZONE_COLORS[zone], line: true }, { key: 'f', label: 'Whole floor', color: '#858479', line: true }]} />
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <LineChart data={hourly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="h" {...axisProps} tickFormatter={(h) => `${h}h`} interval={2} />
                <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(1)}%`} labelFmt={(l) => `${l}:00 local`} />} />
                <Line dataKey="zone" name={zn[zone]} stroke={ZONE_COLORS[zone]} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="floor" name="Whole floor" stroke="#858479" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <p className="small secondary mt-s">
        {zn[zone]}: daily coin-in <Delta v={selCmp.daily_coin_chg as number} />, traffic <Delta v={selCmp.eph_chg as number} />, occupancy <Delta v={selCmp.occupancy_chg as number} /> ({mLabel(first)}→{mLabel(last)}). {!single && interpret(selCmp)}
      </p>

      <div className="grid g-21 mt">
        <Panel title="Machine themes" sub={`Coin-in per available hour change, ${mLabel(first)}→${mLabel(last)} · click a bar to inspect`}
          source={{ tables: ['1_prepared_views/prepared_daily_view'], fields: ['theme', 'coin_in_usd', 'available_hours', 'occupied_hours'] }}>
          {single ? <div className="empty">Choose two or more months.</div> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={themeRows.filter((t) => t.chg !== null)} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="theme" {...axisProps} interval={0} angle={-25} textAnchor="end" height={60} />
                  <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={44} />
                  <ReferenceLine y={0} stroke="#3a4250" />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => signedPct(v, 1)} />} />
                  <Bar dataKey="chg" name="Δ coin-in / avail hr" radius={[4, 4, 4, 4]} isAnimationActive={false} onClick={(d) => f.toggleTheme((d as unknown as { theme: string }).theme)} cursor="pointer">
                    {themeRows.filter((t) => t.chg !== null).map((t) => <Cell key={t.theme} fill={t.theme === theme ? GOLD : SERIES[0]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {themeRows.some((t) => t.note) && <p className="small muted">Not charted: {themeRows.filter((t) => t.note).map((t) => `${t.theme} (${t.note})`).join(', ')}.</p>}
        </Panel>
        <Panel title={theme ? `${theme} by zone` : 'Theme detail'} sub={theme ? p.label : 'Select a theme to see where it sits on the floor'}>
          {theme ? (
            <div className="table-wrap"><table className="dt"><thead><tr><th>Zone</th><th className="num">Occupancy</th><th className="num">Coin-in / avail hr</th></tr></thead>
              <tbody>{themeZone.map((t) => <tr key={t.zone_id}><td>{t.zone}</td><td className="num">{pct(t.occ, 1)}</td><td className="num">{usd(t.cph)}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="table-wrap"><table className="dt"><thead><tr><th>Theme</th><th className="num">Machines</th><th className="num">Occupancy</th><th className="num">Coin-in/hr</th></tr></thead>
              <tbody>{themeRows.map((t) => <tr key={t.theme} className="clickable" onClick={() => setTheme(t.theme)}><td>{t.theme}</td><td className="num">{t.machines}</td><td className="num">{pct(t.occ, 1)}</td><td className="num">{usd(t.cph)}</td></tr>)}</tbody></table></div>
          )}
          {theme && <button className="btn sm mt-s" onClick={() => setTheme('')}>Clear theme</button>}
        </Panel>
      </div>

      <Panel className="mt" title="Events calendar" sub="Citywide events and property promotions in the selected period" source={{ tables: ['4_context/events'] }}>
        <div className="table-wrap"><table className="dt"><thead><tr><th>Event</th><th>Type</th><th>Dates</th><th>Scope</th><th>Announced</th></tr></thead>
          <tbody>{events.length === 0 ? <tr><td colSpan={5} className="empty">No events in this period.</td></tr> : events.map((e) => <tr key={e.event_id}><td className="strong">{e.name}</td><td>{e.event_type.replace(/_/g, ' ')}</td><td>{dLabel(e.start_date)} – {dLabel(e.end_date)}</td><td>{e.local_scope}</td><td>{e.announced_date}</td></tr>)}</tbody></table></div>
      </Panel>
    </div>
  )
}

function Delta({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className="muted">—</span>
  return <span className={v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'muted'}>{signedPct(v, 1)}</span>
}

/** Data-conditional reading of a zone's change; deliberately phrased as 'consistent with', never as cause. */
function interpret(c: Record<string, string | number | null>) {
  const d = c.daily_coin_chg as number, e = c.eph_chg as number, o = c.occupancy_chg as number, cpo = c.cpo_chg as number
  const r = (c.corr as number).toFixed(3)
  if (d < 0 && o < 0 && e < 0)
    return <>Coin-in, foot traffic and occupancy all fell; daily traffic and coin-in correlate at r = {r}. This is <b>consistent with fewer people reaching the zone</b> rather than worse machines.</>
  if (d < 0 && o >= 0)
    return <>Occupancy held or rose while coin-in fell — coin-in per occupied hour changed <Delta v={cpo} />. This is <b>consistent with lower wagering per player-hour</b> (smaller bets or slower play), not fewer players.</>
  if (d >= 0 && e < 0)
    return <>Coin-in rose despite lower foot traffic — <b>more wagering per visitor</b> (coin-in per occupied hour <Delta v={cpo} />).</>
  return <>Coin-in and foot traffic moved together (r = {r}).</>
}
