import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Closure, Q2Data } from '../lib/types'
import { dLabel, num, signedPct, usd } from '../lib/format'
import { Callout, Legend, Panel } from './ui'
import { axisProps, ChartTip, GOLD, gridProps, ZONE_COLORS } from './chart'

const FOCUS = 'Z-PIT' // Center Pit, the largest zone, is the natural place for displaced players to go

/** Q2 · the walkway closure: before / during / after, timeline and difference-in-differences. */
export function ClosureAnalysis({ data, closure, onZone }: { data: Q2Data; closure: Closure; onZone?: (z: string) => void }) {
  const zn = Object.fromEntries(data.zones.map((z) => [z.zone_id, z.zone_name]))
  const c = closure
  const far = c.zones[c.zone_b]
  const pit = c.zones[FOCUS]
  const near = c.zones[c.zone_a]
  const shown = [c.zone_b, FOCUS, c.zone_a].filter((z, i, a) => c.zones[z] && a.indexOf(z) === i)

  // 7-day trailing average of daily coin-in, indexed to each zone's own before-window mean (= 100).
  const dates = (data.zone_daily[c.zone_b] ?? []).map((r) => r[0])
  const series = dates.map((d, i) => {
    const row: Record<string, number | string | null> = { d }
    shown.forEach((z) => {
      const rows = data.zone_daily[z] ?? []
      const w = rows.slice(Math.max(0, i - 6), i + 1)
      const base = c.zones[z].before.coin_in_per_day
      row[z] = w.length === 7 ? (w.reduce((a, r) => a + r[1], 0) / 7 / base) * 100 : null
    })
    return row
  })

  const rows = Object.entries(c.zones).sort((a, b) => a[1].did_during_pp - b[1].did_during_pp)
  const reopenGap = far.did_after_pp

  return (
    <>
      <Callout title={`Answer: the ${zn[c.zone_a]}–${zn[c.zone_b]} walkway closure`} tone="gold">
        The walkway was closed for <b>{c.reason}</b> from {dLabel(c.windows.during[0])} to {dLabel(c.windows.during[1])} ({c.windows.length_days} gaming days).
        {' '}<b>{zn[c.zone_b]}</b> coin-in per day fell <b className="neg">{signedPct(far.chg_during_pct, 1)}</b> and its foot traffic {signedPct(far.traffic_chg_during_pct, 1)} against the {c.windows.length_days} days before —
        {' '}{signedPct(far.did_during_pp, 1).replace('%', '')} points worse than the rest of the floor over the same days.
        {' '}After reopening it recovered only partly ({signedPct(far.chg_after_pct, 1)} vs before; {signedPct(reopenGap, 1).replace('%', '')} pp vs the rest of the floor).
        {' '}<b>{zn[FOCUS]}</b> moved the other way: {signedPct(pit.chg_during_pct, 1)} during and {signedPct(pit.chg_after_pct, 1)} after, consistent with players re-routing and some staying.
      </Callout>

      <div className="grid g-21 mt">
        <Panel title="Timeline: daily coin-in around the closure" sub={`7-day average, indexed to each zone's ${c.windows.length_days}-day pre-closure level (100) · shaded = walkway closed`}
          source={{ tables: ['2_machine_decision/floor_walkways', '1_prepared_views/prepared_daily_view'], fields: ['closed_from_utc', 'closed_to_utc', 'zone_id', 'coin_in_usd'], calc: 'Closure timestamps converted to gaming dates with calendar_day; trailing 7-day mean ÷ pre-closure mean × 100.' }}>
          <Legend items={shown.map((z) => ({ key: z, label: zn[z], color: ZONE_COLORS[z], line: true }))} />
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <ReferenceArea x1={c.windows.during[0]} x2={c.windows.during[1]} fill={GOLD} fillOpacity={0.08} stroke="none"
                  label={{ value: 'walkway closed', fill: GOLD, fontSize: 11, position: 'insideTop' }} />
                <ReferenceLine y={100} stroke="#3a4250" />
                <ReferenceLine x={c.windows.before[0]} stroke="#3a4250" strokeDasharray="3 3" />
                <ReferenceLine x={c.windows.after[1]} stroke="#3a4250" strokeDasharray="3 3" />
                <XAxis dataKey="d" {...axisProps} tickFormatter={dLabel} minTickGap={40} />
                <YAxis {...axisProps} width={40} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip fmt={(v) => v.toFixed(1)} labelFmt={(l) => dLabel(String(l))} />} />
                {shown.map((z) => <Line key={z} dataKey={z} name={zn[z]} stroke={ZONE_COLORS[z]} strokeWidth={z === c.zone_b ? 2.6 : 1.6} dot={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Dashed lines mark the start of the "before" window and the end of the "after" window used in the comparison.</p>
        </Panel>

        <Panel title="Before, during, after" sub={`${zn[c.zone_b]} · ${c.windows.length_days}-day windows`}>
          <dl className="kv">
            <dt>Before ({dLabel(c.windows.before[0])}–{dLabel(c.windows.before[1])})</dt><dd>{usd(far.before.coin_in_per_day, 0)}/day</dd>
            <dt>During ({dLabel(c.windows.during[0])}–{dLabel(c.windows.during[1])})</dt><dd>{usd(far.during.coin_in_per_day, 0)}/day <span className="neg">{signedPct(far.chg_during_pct, 1)}</span></dd>
            <dt>After ({dLabel(c.windows.after[0])}–{dLabel(c.windows.after[1])})</dt><dd>{usd(far.after.coin_in_per_day, 0)}/day <span className={far.chg_after_pct < 0 ? 'neg' : 'pos'}>{signedPct(far.chg_after_pct, 1)}</span></dd>
            <dt>Entries per counter-hour</dt><dd>{num(far.before.entries_per_hour, 1)} → {num(far.during.entries_per_hour, 1)} → {num(far.after.entries_per_hour, 1)}</dd>
            <dt>Occupancy</dt><dd>{(far.before.occupancy * 100).toFixed(1)}% → {(far.during.occupancy * 100).toFixed(1)}% → {(far.after.occupancy * 100).toFixed(1)}%</dd>
            <dt>{zn[c.zone_a]} traffic</dt><dd>{signedPct(near.traffic_chg_during_pct, 1)} during</dd>
          </dl>
          <div className="callout mt-s">
            <div className="callout-title">Competing explanations tested</div>
            <b>Weekday mix:</b> every window is {c.windows.whole_weeks ? 'exactly whole weeks, with the same number of each weekday' : 'not a whole number of weeks'}.
            {' '}<b>Citywide events and season:</b> {c.events_in_windows.map((e) => `${e.name} (${e.window})`).join(', ') || 'none'} fall in these windows; the difference-in-differences subtracts the rest of the floor, which saw the same events.
            {' '}<b>Counter gaps:</b> offline counter-hours in the windows are excluded, never counted as zero ({Object.entries(c.offline_counter_hours).map(([z, n]) => `${zn[z]} ${n}`).join(', ')}).
          </div>
        </Panel>
      </div>

      <Panel className="mt" title="Every zone over the same windows" sub="Δ = change vs the pre-closure window · DiD = zone change minus rest-of-floor change (percentage points) · click a zone to drill down"
        source={{ tables: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly'], fields: ['coin_in_usd', 'entries_count', 'coverage_minutes', 'counter_status'], script: 'pipeline/analytics.py · closure_windows, window_stats, diff_in_diff' }}>
        <div className="table-wrap"><table className="dt"><thead><tr>
          <th>Zone</th><th className="num">Before /day</th><th className="num">Δ during</th><th className="num">Δ after</th><th className="num">Traffic Δ during</th><th className="num">DiD during</th><th className="num">DiD after</th>
        </tr></thead><tbody>
          {rows.map(([z, v]) => (
            <tr key={z} className={onZone ? 'clickable' : ''} onClick={onZone ? () => onZone(z) : undefined}>
              <td className={z === c.zone_b || z === FOCUS ? 'strong' : ''}><span className="status-dot" style={{ background: ZONE_COLORS[z], marginRight: 6 }} />{zn[z]}{z === c.zone_b ? ' · far side of closed walkway' : z === c.zone_a ? ' · near side' : ''}</td>
              <td className="num">{usd(v.before.coin_in_per_day, 0)}</td>
              <td className={`num ${v.chg_during_pct < -1 ? 'neg' : v.chg_during_pct > 1 ? 'pos' : ''}`}>{signedPct(v.chg_during_pct, 1)}</td>
              <td className={`num ${v.chg_after_pct < -1 ? 'neg' : v.chg_after_pct > 1 ? 'pos' : ''}`}>{signedPct(v.chg_after_pct, 1)}</td>
              <td className="num">{signedPct(v.traffic_chg_during_pct, 1)}</td>
              <td className={`num ${v.did_during_pp < -1 ? 'neg' : v.did_during_pp > 1 ? 'pos' : ''}`}>{v.did_during_pp.toFixed(1)}</td>
              <td className={`num ${v.did_after_pp < -1 ? 'neg' : v.did_after_pp > 1 ? 'pos' : ''}`}>{v.did_after_pp.toFixed(1)}</td>
            </tr>
          ))}
          <tr><td className="strong">Whole floor</td><td className="num">{usd(c.floor.before.coin_in_per_day, 0)}</td>
            <td className="num">{signedPct((c.floor.during.coin_in_per_day / c.floor.before.coin_in_per_day - 1) * 100, 1)}</td>
            <td className="num">{signedPct((c.floor.after.coin_in_per_day / c.floor.before.coin_in_per_day - 1) * 100, 1)}</td><td /><td /><td /></tr>
        </tbody></table></div>
        <p className="small muted mt-s">Limits: the closure is the only floor change recorded in these windows, but routes of individual guests are not observed, and traffic counts entries (not unique visitors). The pattern is consistent with re-routing; it does not prove it.</p>
      </Panel>
    </>
  )
}
