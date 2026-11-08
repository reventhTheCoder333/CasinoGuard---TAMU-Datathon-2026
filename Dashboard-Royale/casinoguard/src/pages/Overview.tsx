import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import type { Meta, Overview as OV, Q2Data, Q3Data, Q4Data, Q5Data, RecsData } from '../lib/types'
import { dLabel, hours, mLabel, num, pct, pctv, sum, usd, usdShort } from '../lib/format'
import { Callout, Kpi, Legend, Loading, Meter, PageHead, Panel } from '../components/ui'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from '../components/chart'
import { useInsight } from '../components/Insight'
import { metricDef } from '../lib/metrics'

export default function Overview() {
  const p = usePeriod()
  const meta = useData<Meta>('meta')
  const ov = useData<OV>('overview')
  const q2 = useData<Q2Data>('q2')
  const q3 = useData<Q3Data>('q3')
  const q4 = useData<Q4Data>('q4')
  const q5 = useData<Q5Data>('q5')
  const recs = useData<RecsData>('recommendations')
  const insight = useInsight()

  const daily = useMemo(() => {
    if (!ov.data) return []
    const rows = ov.data.daily.filter((d) => p.inRange(d.gaming_date))
    return rows.map((d, i) => {
      const w = rows.slice(Math.max(0, i - 6), i + 1)
      return { ...d, ma7: w.length === 7 ? sum(w, (x) => x.coin_in_usd) / 7 : null }
    })
  }, [ov.data, p])

  if (!meta.data || !ov.data || !q2.data || !q3.data || !q4.data || !q5.data || !recs.data)
    return <Loading error={meta.error || ov.error || q3.error || q4.error || q5.error} />

  const r = q4.data.ranges[p.key]
  const tk = q3.data.tickets.filter((t) => p.inRange(t.gaming_date))
  const downtime = sum(tk, (t) => t.downtime_hours)
  const q5m = q5.data.monthly.filter((m) => p.inRange(m.month))
  const compCost = sum(q5m, (m) => m.comp_cost)
  const compFace = sum(q5m, (m) => m.face)
  const propCoin = sum(daily, (d) => d.coin_in_usd)
  const propWin = sum(daily, (d) => d.house_win_usd)
  const propTheo = sum(daily, (d) => d.theo_usd)
  const cov = meta.data.coverage
  const ev = recs.data.evidence
  const full = q4.data.ranges['0-5']

  const zm = q2.data.zone_month
  const bfJan = zm.find((z) => z.zone_id === 'Z-B40' && z.month === '2025-01')!
  const bfJun = zm.find((z) => z.zone_id === 'Z-B40' && z.month === '2025-06')!
  const bfDailyChg = ((bfJun.coin_in / bfJun.days) / (bfJan.coin_in / bfJan.days) - 1) * 100
  const bfEntChg = ((bfJun.entries! / bfJun.coverage_hours!) / (bfJan.entries! / bfJan.coverage_hours!) - 1) * 100
  const zoneChg = q2.data.zones.map((z) => {
    const a = zm.find((x) => x.zone_id === z.zone_id && x.month === '2025-01')!, b = zm.find((x) => x.zone_id === z.zone_id && x.month === '2025-06')!
    return { n: z.zone_name, c: ((b.coin_in / b.days) / (a.coin_in / a.days) - 1) * 100 }
  }).sort((x, y) => x.c - y.c)
  const zoneMoves = `${zoneChg[0].n} ${zoneChg[0].c.toFixed(1)}%, ${zoneChg[1].n} ${zoneChg[1].c.toFixed(1)}%, ${zoneChg[zoneChg.length - 1].n} +${zoneChg[zoneChg.length - 1].c.toFixed(1)}% (daily coin-in, Jan→Jun)`
  const ridge = ev.manufacturer.find((m: { manufacturer: string }) => m.manufacturer === 'Ridgeline')
  const halc = ev.manufacturer.find((m: { manufacturer: string }) => m.manufacturer === 'Halcyon')
  const faultDowntime = q3.data.summary.downtime_hours_fault as number
  const jan = q5.data.monthly[0], jun = q5.data.monthly[5]

  const events = q2.data.events.filter((e) => e.end_date >= p.start && e.start_date <= p.end)

  const q4m = q4.data.monthly
  // KPI investigation: the same source rows, broken down by month of the selected period.
  const monthly: Record<string, (mo: string) => number> = {
    tracked_net: (mo) => sum(q4m.filter((x) => x.period_month === mo), (x) => x.casino_net),
    tracked_wager: (mo) => sum(q4m.filter((x) => x.period_month === mo), (x) => x.wager),
    tracked_payout: (mo) => sum(q4m.filter((x) => x.period_month === mo), (x) => x.payout),
    tickets: (mo) => tk.filter((t) => t.gaming_date?.startsWith(mo)).length,
    downtime: (mo) => sum(tk.filter((t) => t.gaming_date?.startsWith(mo)), (t) => t.downtime_hours),
    comp_cost: (mo) => sum(q5m.filter((m) => m.month === mo), (m) => m.comp_cost),
    comp_face: (mo) => sum(q5m.filter((m) => m.month === mo), (m) => m.face),
  }
  const openKpi = (id: string, value: string, to: string, page: string) => {
    const m = metricDef(id)
    const points = p.months.map((mo) => ({ label: mLabel(mo), value: monthly[id](mo) }))
    const best = [...points].sort((a, b) => b.value - a.value)[0]
    insight.open({
      eyebrow: 'KPI investigation', title: m.label, subtitle: p.label, metricId: id,
      kpis: [{ label: `Total · ${p.label}`, value }, { label: 'Highest month', value: best ? `${best.label} · ${m.fmt(best.value)}` : '—' }],
      series: { title: `${m.label} by month`, points, fmt: m.fmt, axis: (v) => (id === 'tickets' ? num(v) : id === 'downtime' ? `${num(v)} h` : usdShort(v, 0)) },
      actions: [{ label: `Open ${page} →`, to, primary: true }],
    })
  }

  return (
    <div>
      <PageHead
        eyebrow="Executive overview"
        title="The Gilded Ace — casino financial intelligence"
        question={<>Six months of floor, maintenance, player and loyalty data, re-computed from the original datasets. Period: <b className="strong">{p.label}</b>{p.isFull ? '' : ' (KPIs recomputed for the selected months)'}.</>}
      />

      <div className="kpis">
        <Kpi label="Tracked casino net" value={usd(r.casino_net)} verified={p.isFull} metric="tracked_net" onOpen={() => openKpi('tracked_net', usd(r.casino_net), '/q4', 'Q4')}
          tip={<><b>Definition:</b> tracked coin-in − tracked payouts for loyalty-card (carded) play only.<br /><b>Source:</b> player_period.tracked_coin_in_usd − tracked_payout_usd. Excludes uncarded play.</>} />
        <Kpi label="Tracked wagering" value={usd(r.wager)} verified={p.isFull} metric="tracked_wager" onOpen={() => openKpi('tracked_wager', usd(r.wager), '/q4', 'Q4')}
          tip={<><b>Definition:</b> total amount wagered (coin-in, incl. re-bet winnings) by carded players.<br /><b>Source:</b> SUM(player_period.tracked_coin_in_usd).</>} />
        <Kpi label="Tracked payouts" value={usd(r.payout)} verified={p.isFull} metric="tracked_payout" onOpen={() => openKpi('tracked_payout', usd(r.payout), '/q4', 'Q4')}
          tip={<><b>Definition:</b> total paid back by games to carded players.<br /><b>Source:</b> SUM(player_period.tracked_payout_usd).</>} />
        <Kpi label="Operations tickets" value={num(tk.length)} sub={`${num(tk.filter((t) => t.event_type === 'fault_repair').length)} fault repairs`} verified={p.isFull} metric="tickets" onOpen={() => openKpi('tickets', num(tk.length), '/q3', 'Q3')}
          tip={<><b>Definition:</b> every ticket in operations (fault repairs, installs, moves, scheduled maintenance, retirements), by gaming date opened.<br /><b>Source:</b> operations (row count). Note: 1,207 of the 1,226 are fault repairs.</>} />
        <Kpi label="Total downtime" value={hours(downtime)} verified={p.isFull} metric="downtime" onOpen={() => openKpi('downtime', hours(downtime), '/q3', 'Q3')}
          tip={<><b>Definition:</b> Σ (available_at_utc − opened_at_utc) over all tickets.<br /><b>Source:</b> operations. UTC timestamps avoid DST errors.</>} />
        <Kpi label="Actual comp cost" value={usd(compCost)} verified={p.isFull} metric="comp_cost" onOpen={() => openKpi('comp_cost', usd(compCost), '/q5', 'Q5')}
          tip={<><b>Definition:</b> economic (cost-of-goods) cost of comps redeemed — what the casino actually spends.<br /><b>Source:</b> SUM(player_period.comp_cost_usd); reconciles to property_day and loyalty_ledger.</>} />
        <Kpi label="Comp face value" value={usd(compFace)} verified={p.isFull} metric="comp_face" onOpen={() => openKpi('comp_face', usd(compFace), '/q5', 'Q5')}
          tip={<><b>Definition:</b> menu (retail) value of comps redeemed. Not a cash cost.<br /><b>Source:</b> SUM(player_period.comp_face_value_usd).</>} />
      </div>

      <div className="grid g-21 mt">
        <Panel
          title="Daily floor coin-in (all play)"
          sub={`Machine meters for every player, carded or not · ${p.label} · shaded = events`}
          source={{ tables: ['1_prepared_views/property_day', '4_context/events'], fields: ['coin_in_usd', 'house_win_usd', 'theo_usd'], calc: '7-day trailing average shown only when 7 days are available in the selected period.' }}
        >
          <Legend items={[{ key: 'c', label: 'Daily coin-in', color: SERIES[0], line: true }, { key: 'm', label: '7-day average', color: GOLD, line: true }]} />
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={daily} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                {events.map((e) => (
                  <ReferenceArea key={e.event_id} x1={e.start_date < p.start ? p.start : e.start_date} x2={e.end_date > p.end ? p.end : e.end_date} fill="#ffffff" fillOpacity={0.04} stroke="none" />
                ))}
                <XAxis dataKey="gaming_date" {...axisProps} tickFormatter={dLabel} minTickGap={40} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 1)} width={56} />
                <Tooltip content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l, pl) => `${dLabel(String(l))} (${pl?.local_weekday})${pl?.events_active ? ' · ' + pl.events_active : ''}`} />} />
                <Line dataKey="coin_in_usd" name="Daily coin-in" stroke={SERIES[0]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="ma7" name="7-day average" stroke={GOLD} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="row mt-s small secondary" style={{ gap: 24 }}>
            <span>Coin-in <b className="strong">{usd(propCoin, 0)}</b></span>
            <span>House win <b className="strong">{usd(propWin, 0)}</b></span>
            <span>Theo (expected) win <b className="strong">{usd(propTheo, 0)}</b></span>
            <span>Hold <b className="strong">{pct(propWin / propCoin)}</b> vs theo {pct(propTheo / propCoin)}</span>
          </div>
        </Panel>

        <Panel title="Data coverage" sub="How complete the inputs are" tip="Coverage of the source tables used throughout the dashboard. Missing traffic hours are excluded, never treated as zero."
          source={{ tables: ['2_machine_decision/calendar_day', '1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly', 'pipeline verification checks'] }}>
          <div className="stack" style={{ gap: 12 }}>
            {[
              { l: 'Gaming days covered', v: `${cov.gaming_days} / 181`, f: Number(cov.gaming_days) / 181 },
              { l: 'Machine-days with machine on floor', v: `${num(Number(cov.active_machine_days))} / ${num(Number(cov.machine_days))}`, f: Number(cov.active_machine_days) / Number(cov.machine_days) },
              { l: 'Traffic counter hours online (ok)', v: `${num(Number(cov.counter_hours_ok))} / ${num(Number(cov.counter_hours))}`, f: Number(cov.counter_hours_ok) / Number(cov.counter_hours) },
              { l: 'Coin-in from carded (tracked) play', v: pct(Number(cov.carded_coin_in_share), 1), f: Number(cov.carded_coin_in_share) },
              { l: 'Verification checks passed', v: `${meta.data.checks_passed} / ${meta.data.checks_total}`, f: meta.data.checks_passed / meta.data.checks_total },
            ].map((x) => (
              <div key={x.l}>
                <div className="row small" style={{ justifyContent: 'space-between' }}><span className="secondary">{x.l}</span><span className="strong tabnum">{x.v}</span></div>
                <Meter value={x.f} />
              </div>
            ))}
            <div className="small muted">
              Data release {meta.data.data_release}. July 2025 is outside the analysis window; the single ledger row after June 30's gaming day is excluded from monthly comparisons.
              {' '}<Link to="/methodology">See all checks →</Link>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="The six questions" sub="Headline answer for each analysis (full Jan–Jun period) — click through for evidence">
          {[
            { k: 'Q1', to: '/q1', q: 'Which machines are underperforming?', a: <>All 10 preliminary candidates sit in <b>Back Forty</b>, where theo per available hour is {usd(ev.back_forty_theo_per_avail_hour)} vs {usd(ev.other_theo_per_avail_hour)} elsewhere. Location, not the machines, is the leading explanation.</> },
            { k: 'Q2', to: '/q2', q: 'How did demand change across the floor?', a: <>Floor demand shifted unevenly: {zoneMoves}. Back Forty's foot traffic per counter-hour changed {pctv(bfEntChg, 1)} alongside its {pctv(bfDailyChg, 1)} coin-in drop (daily r = {q2.data.traffic_demand_corr['Z-B40'].toFixed(3)}).</> },
            { k: 'Q3', to: '/q3', q: 'How much play was lost to downtime?', a: <>{num(faultDowntime, 0)} fault-repair hours ≈ {usd(q3.data.summary.est_exposure_fault as number, 0)} of <i>estimated</i> theo exposure. Ridgeline machines log {ridge.tickets_per_machine.toFixed(1)} repairs each vs {halc.tickets_per_machine.toFixed(1)} for Halcyon.</> },
            { k: 'Q4', to: '/q4', q: 'What did tracked players wager, get back and net?', a: <>{usd(full.wager, 0)} wagered, {usd(full.payout, 0)} returned, {usd(full.casino_net, 0)} casino net. {pctv(full.loss_share['5'])} of gross losses come from the top 5% of losing players.</> },
            { k: 'Q5', to: '/q5', q: 'What did comps cost, and did anything change?', a: <>{usd(q5.data.summary.economic_cost)} economic cost. From May 1, points charged per comp dollar roughly <b>halved in every tier</b>; comp cost / tracked theo rose {pctv(jan.cost_pct_tracked_theo)} → {pctv(jun.cost_pct_tracked_theo)}.</> },
            { k: 'Q6', to: '/q6', q: 'Which actions would we fund with $100,000?', a: <>{recs.data.selected.map((a) => `${a.action_type_id}${a.quantity > 1 ? ` ×${a.quantity}` : ''}`).join(', ')}: <b>{usd(recs.data.spent, 0)}</b> invested, <b>{usd(recs.data.preserved, 0)}</b> preserved. Each is a 30-day test with a baseline and a comparison group.</> },
          ].map((x) => (
            <div className="qrow" key={x.k}>
              <div className="qk">{x.k}</div>
              <div><div className="qq">{x.q}</div><div className="qa">{x.a}</div></div>
              <Link to={x.to} className="btn sm">Open →</Link>
            </div>
          ))}
        </Panel>

        <div className="stack">
          <Panel title="Potential management actions" sub={`Priced from action_catalog · ${usd(recs.data.spent, 0)} of ${usd(recs.data.budget, 0)} committed`}>
            <ol className="list">
              {recs.data.selected.map((a) => (
                <li key={a.action_type_id}><b>{a.name}</b> — {usd(a.total_cost, 0)} <span className="muted">({a.action_type_id})</span></li>
              ))}
              <li><b>Preserve {usd(recs.data.preserved, 0)}</b> (A-HOLD) — no replacements on current evidence; funds are released only when a test supports it.</li>
            </ol>
            <Link to="/q6" className="btn gold mt-s">View Q6 budget & measurement plans →</Link>
          </Panel>
          <Callout title="How to read this dashboard" tone="gold">
            Every number is computed from the original tables by <code>pipeline/build_data.py</code>; the team's verified Q1–Q5 results are re-derived and asserted ({meta.data.checks_passed}/{meta.data.checks_total} checks pass).
            <b> Estimates</b> (e.g. lost-play exposure) are labelled as such. Use the <b>Source</b> button on any panel to see the dataset and fields behind it.
          </Callout>
        </div>
      </div>
    </div>
  )
}
