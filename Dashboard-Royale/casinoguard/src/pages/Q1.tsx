import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Bar } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import { useFilters } from '../lib/filters'
import type { Q1Data } from '../lib/types'
import { scoreMachines, minDaysFor, type MachinePerf } from '../lib/q1'
import { dLabel, num, pct, usd, usdShort } from '../lib/format'
import { Callout, Kpi, Legend, Loading, PageHead, Panel, Select } from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from '../components/chart'

const ZONE_NAMES: Record<string, string> = {}

export default function Q1() {
  const p = usePeriod()
  const { data, error } = useData<Q1Data>('q1')
  // Zone and theme are the global filters, so they carry across pages and cross-filter the Explorer.
  const { zone, setZone, theme, setTheme } = useFilters()
  const [cfg, setCfg] = useState('')
  const [mfr, setMfr] = useState('')
  const [scope, setScope] = useState<'eligible' | 'all'>('eligible')
  const [topN, setTopN] = useState(10)
  const [sel, setSel] = useState<string | null>(null)

  const perf = useMemo(() => (data ? scoreMachines(data, p.months, p.days) : []), [data, p.months, p.days])
  if (data) data.machines.forEach((m) => { if (m.zone_id) ZONE_NAMES[m.zone_id] = m.zone_name })

  const ranked = useMemo(() => perf.filter((m) => m.rank !== null).sort((a, b) => a.rank! - b.rank!), [perf])
  const candidates = useMemo(() => new Set(ranked.slice(0, topN).map((m) => m.machine_id)), [ranked, topN])
  const visible = useMemo(() => perf.filter((m) =>
    (!zone || m.period_zone === zone) && (!theme || m.theme === theme) && (!cfg || m.config_id === cfg) && (!mfr || m.manufacturer === mfr) && (scope === 'all' || m.eligible),
  ), [perf, zone, theme, cfg, mfr, scope])

  if (!data) return <Loading error={error} />

  const minDays = minDaysFor(p.days)
  const top10 = ranked.slice(0, 10).map((m) => m.machine_id)
  const matchesTeam = p.isFull && top10.join() === data.team_top10.join()
  const inBF = ranked.slice(0, topN).filter((m) => m.period_zone === 'Z-B40').length
  const naiveIds = new Set(data.naive_bottom10.map((n) => n.machine_id))
  const overlap = top10.filter((id) => naiveIds.has(id)).length
  const aboveTheo = ranked.slice(0, topN).filter((m) => m.luck > 0).length
  const selected = sel ? perf.find((m) => m.machine_id === sel) ?? null : null
  const filtersOn = zone || theme || cfg || mfr || scope !== 'eligible'

  const zones = [...new Set(data.machines.map((m) => m.zone_id).filter(Boolean))].sort()
  const cfgs = [...new Set(data.machines.map((m) => m.config_id))].sort()
  const mfrs = [...new Set(data.machines.map((m) => m.manufacturer))].sort()

  // Zone summary
  const zoneRows = zones.map((z) => {
    const ms = perf.filter((m) => m.period_zone === z && m.available_hours > 0)
    const av = ms.reduce((a, m) => a + m.available_hours, 0)
    return {
      zone_id: z, zone_name: ZONE_NAMES[z], machines: ms.length,
      occupancy: ms.reduce((a, m) => a + m.occupied_hours, 0) / av,
      theo_per_hour: ms.reduce((a, m) => a + m.theo, 0) / av,
      in_top: ranked.slice(0, topN).filter((m) => m.period_zone === z).length,
    }
  })

  const cols: Column<MachinePerf>[] = [
    { key: 'rank', label: 'Rank', num: true, value: (m) => m.rank, render: (m) => m.rank ?? <span className="muted">n/e</span> },
    { key: 'machine_id', label: 'Machine', render: (m) => <span className="strong">{m.machine_id}{candidates.has(m.machine_id) && <span className="badge gold" style={{ marginLeft: 6 }}>candidate</span>}</span> },
    { key: 'theme', label: 'Theme' },
    { key: 'config_id', label: 'Config' },
    { key: 'zone', label: 'Zone', value: (m) => ZONE_NAMES[m.period_zone ?? ''] ?? '—' },
    { key: 'period_bank', label: 'Bank', value: (m) => m.period_bank ?? '—' },
    { key: 'occupancy', label: 'Occupancy', num: true, render: (m) => pct(m.occupancy) },
    { key: 'theo_per_hour', label: 'Theo win / avail hr', num: true, render: (m) => usd(m.theo_per_hour) },
    { key: 'win_per_hour', label: 'Actual win / avail hr', num: true, render: (m) => usd(m.win_per_hour) },
    { key: 'luck', label: 'Luck (actual − theo)', num: true, render: (m) => <span className={m.luck >= 0 ? 'pos' : 'neg'}>{usd(m.luck, 0)}</span> },
    { key: 'availability', label: 'Availability', num: true, render: (m) => pct(m.availability, 1) },
    { key: 'occ_vs_zone', label: 'Occ. vs zone', num: true, title: 'Machine occupancy ÷ pooled occupancy of its zone', render: (m) => Number.isFinite(m.occ_vs_zone) ? `${m.occ_vs_zone.toFixed(2)}×` : '—' },
    { key: 'score', label: 'Score', num: true, render: (m) => Number.isFinite(m.score) ? m.score.toFixed(3) : '—' },
  ]

  const pts = (inCand: boolean) => visible.filter((m) => Number.isFinite(m.occupancy) && Number.isFinite(m.theo_per_hour) && candidates.has(m.machine_id) === inCand)
    .map((m) => ({ x: m.occupancy * 100, y: m.theo_per_hour, id: m.machine_id, theme: m.theme, zone: ZONE_NAMES[m.period_zone ?? ''], rank: m.rank }))

  return (
    <div>
      <PageHead eyebrow="Q1 · Machine performance intelligence" title="Which machines are truly underperforming?"
        question="Ranks machines on exposure-adjusted earning power (theoretical win per available hour) and demand (occupancy), compared only against machines with the same game configuration." />

      <Callout title="Scoring methodology — preliminary candidates, not replacement orders" tone="gold">
        <b>Score = 0.60 × (1 − theo-win/hr percentile) + 0.40 × (1 − occupancy percentile)</b>, percentiles computed within each <code>config_id</code> (same RTP/game math).
        Eligible machines need <b>≥ {minDays} days on the floor</b>{p.isFull ? '' : ` (90 for the full half-year; scaled to half of the ${p.days}-day window)`} and positive available hours. (The team script counted calendar rows, which let every machine pass; counting on-floor days also excludes M-5076 and M-1118 and leaves the top 10 unchanged.)
        Theo (expected) win is used instead of actual win so a lucky or unlucky machine is not mis-ranked. A high score flags a machine for review — it does not prove the machine itself is the problem.
      </Callout>

      <div className="kpis mt">
        <Kpi label="Eligible machines" value={num(ranked.length)} sub={`of ${data.machines.length} registered · ${p.label}`} tip="Machines meeting the minimum on-floor days and positive available hours in the selected period." />
        <Kpi label={`Top ${topN} in Back Forty`} value={`${inBF} / ${topN}`} sub="Location concentration of candidates" tip="How many of the top-ranked candidates were located in the Back Forty zone (dominant location in the period)." />
        <Kpi label={`Top ${topN} with actual ≥ theo`} value={`${aboveTheo} / ${topN}`} sub="Luck did not depress their results" tip="Luck residual = actual house win − theoretical win. Positive means the machine earned more than its math predicts." />
        <Kpi label="Overlap with manager's list" value={`${overlap} / 10`} sub="vs bottom 10 by raw total house win" tip="The GM's plan: replace the 10 machines with the lowest total house win (GUIDE.md starter query, full period). Raw totals ignore luck, exposure and availability." />
        <Kpi label="Team verification" value={p.isFull ? (matchesTeam ? 'Match' : 'Mismatch') : 'n/a'} tone={p.isFull ? (matchesTeam ? 'pos' : 'neg') : undefined}
          sub={p.isFull ? 'Top 10 equals FINAL_BOTTOM_10_CANDIDATES.csv' : 'Verification applies to Jan–Jun'} tip="The client re-runs the team's finalize_bottom_10.py scoring; on the full period it must reproduce the verified list exactly." />
      </div>

      <div className="filters mt">
        <Select label="Zone" value={zone} onChange={setZone} allLabel="All zones" options={zones.map((z) => ({ value: z, label: ZONE_NAMES[z] }))} />
        <Select label="Theme" value={theme} onChange={setTheme} allLabel="All themes" options={[...new Set(data.machines.map((m) => m.theme))].sort().map((t) => ({ value: t, label: t }))} />
        <Select label="Configuration" value={cfg} onChange={setCfg} allLabel="All configs" options={cfgs.map((c) => ({ value: c, label: c }))} />
        <Select label="Manufacturer" value={mfr} onChange={setMfr} allLabel="All" options={mfrs.map((c) => ({ value: c, label: c }))} />
        <Select label="Show" value={scope} onChange={(v) => setScope(v as 'eligible' | 'all')} options={[{ value: 'eligible', label: 'Eligible only' }, { value: 'all', label: 'All machines' }]} />
        <Select label="Candidates" value={String(topN)} onChange={(v) => setTopN(Number(v))} options={[10, 20, 30].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
        {filtersOn && <button className="btn sm" onClick={() => { setZone(''); setTheme(''); setCfg(''); setMfr(''); setScope('eligible') }}>Reset filters</button>}
      </div>

      <div className="grid g-21">
        <Panel title="Occupancy vs theoretical win per available hour" sub={`${visible.length} machines · click a point for details`}
          source={{ tables: ['1_prepared_views/prepared_daily_view'], fields: ['occupied_hours', 'available_hours', 'theo_usd', 'config_id'], calc: <>Occupancy = Σ occupied_hours ÷ Σ available_hours. Theo/hr = Σ theo_usd ÷ Σ available_hours (ratio of sums).</> }}>
          <Legend items={[{ key: 'o', label: 'Other machines', color: SERIES[0] }, { key: 'c', label: `Top ${topN} candidates`, color: SERIES[1] }, { key: 's', label: 'Selected', color: GOLD }]} />
          <div style={{ height: 330 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <CartesianGrid {...gridProps} vertical />
                <XAxis type="number" dataKey="x" name="Occupancy" unit="%" {...axisProps} domain={['auto', 'auto']} label={{ value: 'Occupancy (%)', position: 'insideBottom', offset: -4, fill: '#858479', fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name="Theo / hr" {...axisProps} tickFormatter={(v) => `$${v}`} width={48} />
                <ZAxis range={[46, 46]} />
                <Tooltip cursor={{ stroke: '#3a4250' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as { id: string; x: number; y: number; theme: string; zone: string; rank: number | null }
                  return <div className="chart-tip"><div className="tt-title">{d.id} · {d.theme} · {d.zone}</div>
                    <div className="tt-row"><span className="tt-val">{d.x.toFixed(2)}%</span><span className="tt-name">occupancy</span></div>
                    <div className="tt-row"><span className="tt-val">{usd(d.y)}</span><span className="tt-name">theo / available hr</span></div>
                    <div className="tt-row"><span className="tt-val">{d.rank ?? 'not eligible'}</span><span className="tt-name">rank</span></div></div>
                }} />
                <Scatter name="Other" data={pts(false)} fill={SERIES[0]} fillOpacity={0.55} onClick={(d) => setSel((d as unknown as { id: string }).id)} isAnimationActive={false} cursor="pointer" />
                <Scatter name="Candidates" data={pts(true)} fill={SERIES[1]} stroke="#151922" strokeWidth={1.5} onClick={(d) => setSel((d as unknown as { id: string }).id)} isAnimationActive={false} cursor="pointer" />
                {selected && Number.isFinite(selected.occupancy) && (
                  <Scatter name="Selected" data={[{ x: selected.occupancy * 100, y: selected.theo_per_hour, id: selected.machine_id, theme: selected.theme, zone: ZONE_NAMES[selected.period_zone ?? ''], rank: selected.rank }]}
                    fill="none" stroke={GOLD} strokeWidth={2.5} shape="circle" isAnimationActive={false} />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Where the candidates sit" sub={`Zone context · ${p.label}`} tip="Pooled occupancy and theo/hr per zone. If nearly all candidates share a low-traffic zone, location is a competing explanation to 'bad machine'."
          source={{ tables: ['1_prepared_views/prepared_daily_view'], fields: ['zone_id', 'occupied_hours', 'available_hours', 'theo_usd'] }}>
          <div className="table-wrap">
            <table className="dt">
              <thead><tr><th>Zone</th><th className="num">Machines</th><th className="num">Occupancy</th><th className="num">Theo/hr</th><th className="num">In top {topN}</th></tr></thead>
              <tbody>
                {zoneRows.sort((a, b) => b.in_top - a.in_top || a.occupancy - b.occupancy).map((z) => (
                  <tr key={z.zone_id} className="clickable" onClick={() => setZone(z.zone_id === zone ? '' : z.zone_id)}>
                    <td className={z.zone_id === zone ? 'strong' : ''}>{z.zone_name}</td>
                    <td className="num">{z.machines}</td><td className="num">{pct(z.occupancy, 1)}</td><td className="num">{usd(z.theo_per_hour)}</td>
                    <td className="num">{z.in_top > 0 ? <b className="strong">{z.in_top}</b> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted mt-s">Click a zone to filter. Back Forty has the lowest occupancy and theo/hr on the floor, so machines there rank low against same-config peers placed in busier zones. <Link to="/q2">See demand trends →</Link></p>
        </Panel>
      </div>

      {selected && <MachineDetail m={selected} data={data} onClose={() => setSel(null)} isCandidate={candidates.has(selected.machine_id)} naive={naiveIds.has(selected.machine_id)} />}

      <Panel className="mt" title="Underperformance ranking" sub={`Highest score = weakest relative to same-config peers · ${p.label}`}
        source={{ tables: ['1_prepared_views/prepared_daily_view', '2_machine_decision/machines'], fields: ['theo_usd', 'house_win_usd', 'luck_residual_usd', 'available_hours', 'occupied_hours', 'config_id'], script: 'finalize_bottom_10.py (team) → re-implemented in src/lib/q1.ts', calc: 'Availability = Σ available_hours ÷ Σ scheduled hours (calendar_day.scheduled_seconds, DST-aware) on active days.' }}>
        <DataTable rows={visible} columns={cols} rowKey={(m) => m.machine_id} searchKeys={['machine_id', 'theme', 'config_id', 'manufacturer', 'period_bank']}
          searchPlaceholder="Search machine, theme, bank…" initialSort={{ key: 'rank', dir: 'asc' }} onRowClick={(m) => setSel(m.machine_id)} selectedKey={sel}
          csvName={`q1_machine_ranking_${p.key}`} pageSize={12} />
      </Panel>

      <Panel className="mt" title="Manager's list vs exposure-adjusted list" sub="The GM's plan ranks by raw total house win (full Jan–Jun). Raw totals penalise unlucky, broken or newly installed machines.">
        <div className="grid g2">
          <div className="table-wrap"><table className="dt"><thead><tr><th>Manager's bottom 10 (raw house win)</th><th className="num">House win</th><th>In our top 10?</th></tr></thead>
            <tbody>{data.naive_bottom10.map((n) => {
              const m = perf.find((x) => x.machine_id === n.machine_id)
              return <tr key={n.machine_id} className="clickable" onClick={() => setSel(n.machine_id)}><td className="strong">{n.machine_id} <span className="muted">{m?.theme} · {ZONE_NAMES[m?.zone_id ?? '']}</span></td><td className="num">{usd(n.house_win, 0)}</td><td>{top10.includes(n.machine_id) ? <span className="badge gold">yes</span> : <span className="muted">no</span>}</td></tr>
            })}</tbody></table></div>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Our top 10 ({p.label})</th><th className="num">Luck</th><th className="num">Avail.</th></tr></thead>
            <tbody>{ranked.slice(0, 10).map((m) => <tr key={m.machine_id} className="clickable" onClick={() => setSel(m.machine_id)}><td className="strong">{m.rank}. {m.machine_id} <span className="muted">{m.theme} · {ZONE_NAMES[m.period_zone ?? '']}</span></td><td className={`num ${m.luck >= 0 ? 'pos' : 'neg'}`}>{usd(m.luck, 0)}</td><td className="num">{pct(m.availability, 1)}</td></tr>)}</tbody></table></div>
        </div>
      </Panel>
    </div>
  )
}

function MachineDetail({ m, data, onClose, isCandidate, naive }: { m: MachinePerf; data: Q1Data; onClose: () => void; isCandidate: boolean; naive: boolean }) {
  const wk = (data.weekly[m.machine_id] ?? []).map(([w, av, oc, th, hw, f]) => ({ w, occ: av > 0 ? (oc / av) * 100 : null, theo: th, win: hw, faults: f }))
  const evidence: string[] = []
  evidence.push(m.luck >= 0 ? `Actual win exceeded theoretical by ${usd(m.luck, 0)} — low results are not explained by bad luck.` : `Actual win trailed theoretical by ${usd(-m.luck, 0)} — part of the shortfall is luck, which should not drive replacement.`)
  evidence.push(m.availability >= 0.95 ? `Availability ${pct(m.availability, 1)} — downtime is not a major factor.` : `Availability only ${pct(m.availability, 1)} — downtime reduces its chances to earn (see Q3).`)
  if (Number.isFinite(m.occ_vs_zone)) evidence.push(`Occupancy is ${m.occ_vs_zone.toFixed(2)}× its zone average (${pct(m.zone_occupancy, 1)}); ${m.zone_rank ? `on the same score it ranks ${m.zone_rank} of ${m.zone_count} machines in its zone.` : ''}`)
  if (m.locations_used > 1) evidence.push(`Moved during the half-year (${m.locations_used} locations) — compare periods before/after the move.`)
  evidence.push(`Configured RTP ${pct(m.configured_rtp, 0)}, ${m.volatility} volatility (${m.config_id}).`)
  return (
    <Panel className="mt detail" title={<>{m.machine_id} · {m.theme} {isCandidate && <span className="badge gold">candidate</span>} {naive && <span className="badge">on manager's list</span>}</>}
      sub={`${m.manufacturer} · ${m.lease_class.replace(/_/g, ' ')} · ${m.zone_name} / ${m.bank_id} / ${m.location_id} · installed ${m.install_date}${m.retire_date ? ` · retired ${m.retire_date}` : ''}`}
      actions={<button className="btn sm" onClick={onClose}>Close ✕</button>}
      source={{ tables: ['1_prepared_views/prepared_daily_view', '2_machine_decision/machines', '2_machine_decision/game_math'], fields: ['available_hours', 'occupied_hours', 'theo_usd', 'house_win_usd', 'luck_residual_usd', 'faults_opened'] }}>
      <div className="grid g3">
        <dl className="kv">
          <dt>Rank / score</dt><dd>{m.rank ?? 'not eligible'} · {Number.isFinite(m.score) ? m.score.toFixed(3) : '—'}</dd>
          <dt>Theo-win percentile (config)</dt><dd>{pct(m.theo_pctile, 1)}</dd>
          <dt>Occupancy percentile (config)</dt><dd>{pct(m.occ_pctile, 1)}</dd>
          <dt>Observed / active days</dt><dd>{m.observed_days} / {m.active_days}</dd>
          <dt>Available hours</dt><dd>{num(m.available_hours, 1)}</dd>
          <dt>Occupancy</dt><dd>{pct(m.occupancy)}</dd>
        </dl>
        <dl className="kv">
          <dt>Coin-in</dt><dd>{usd(m.coin_in, 0)}</dd>
          <dt>Theoretical win</dt><dd>{usd(m.theo, 0)}</dd>
          <dt>Actual house win</dt><dd>{usd(m.house_win, 0)}</dd>
          <dt>Theo win / avail hr</dt><dd>{usd(m.theo_per_hour)}</dd>
          <dt>Actual win / avail hr</dt><dd>{usd(m.win_per_hour)}</dd>
          <dt>Contribution after costs</dt><dd>{usd(m.contribution, 0)}</dd>
        </dl>
        <div>
          <h3 style={{ marginBottom: 6 }}>Evidence</h3>
          <ul className="list small">{evidence.map((e) => <li key={e}>{e}</li>)}</ul>
          <div className="small muted">Faults {m.faults} · repair cost {usd(m.repair_cost, 0)} · <Link to="/q3">maintenance →</Link></div>
        </div>
      </div>
      <div className="grid g2 mt">
        <div>
          <Legend items={[{ key: 't', label: 'Weekly theo win', color: SERIES[0] }, { key: 'w', label: 'Weekly actual win', color: SERIES[1], line: true }]} />
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <ComposedChart data={wk} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="w" {...axisProps} tickFormatter={dLabel} minTickGap={30} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 1)} width={50} />
                <Tooltip content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l) => `Week of ${dLabel(String(l))}`} />} />
                <Bar dataKey="theo" name="Theo win" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line dataKey="win" name="Actual win" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <Legend items={[{ key: 'o', label: 'Weekly occupancy (%)', color: GOLD, line: true }]} />
          <div style={{ height: 180 }}>
            <ResponsiveContainer>
              <ComposedChart data={wk} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="w" {...axisProps} tickFormatter={dLabel} minTickGap={30} />
                <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(1)}%`} labelFmt={(l) => `Week of ${dLabel(String(l))}`} />} />
                <Line dataKey="occ" name="Occupancy" stroke={GOLD} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <p className="small muted mt-s">Weekly charts show the full Jan–Jun history for context, regardless of the selected period. The first (Jan 1–5) and last (Jun 30) weeks are partial.</p>
    </Panel>
  )
}
