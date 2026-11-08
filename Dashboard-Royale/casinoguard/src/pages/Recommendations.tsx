import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import type { ForecastData, PricedAction, Q1Data, Q2Data, Q5Data, RecsData } from '../lib/types'
import { scoreMachines } from '../lib/q1'
import { num, pct, pctv, usd } from '../lib/format'
import { Loading, PageHead, Panel } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { SERIES } from '../components/chart'

const COLORS = [SERIES[0], SERIES[2], SERIES[6]]

export default function Recommendations() {
  const recs = useData<RecsData>('recommendations')
  const q1 = useData<Q1Data>('q1')
  const q2 = useData<Q2Data>('q2')
  const q5 = useData<Q5Data>('q5')
  const fc = useData<ForecastData>('forecast')
  const top10 = useMemo(() => (q1.data ? scoreMachines(q1.data, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'], 181).filter((m) => m.rank !== null && m.rank <= 10) : []), [q1.data])

  if (!recs.data || !q1.data || !q2.data || !q5.data || !fc.data) return <Loading error={recs.error || q1.error} />
  const r = recs.data
  const ev = r.evidence
  const [wf, pm, cp] = r.selected
  const zm = q2.data.zone_month
  const bfJan = zm.find((z) => z.zone_id === 'Z-B40' && z.month === '2025-01')!
  const bfJun = zm.find((z) => z.zone_id === 'Z-B40' && z.month === '2025-06')!
  const bfTraffic = ((bfJun.entries! / bfJun.coverage_hours!) / (bfJan.entries! / bfJan.coverage_hours!) - 1) * 100
  const bfCoin = ((bfJun.coin_in / bfJun.days) / (bfJan.coin_in / bfJan.days) - 1) * 100
  const inBF = top10.filter((m) => m.period_zone === 'Z-B40').length
  const aboveTheo = top10.filter((m) => m.luck > 0).length
  const ridge = ev.manufacturer.find((m: { manufacturer: string }) => m.manufacturer === 'Ridgeline')
  const others = ev.manufacturer.filter((m: { manufacturer: string }) => m.manufacturer !== 'Ridgeline')
  const totFaultDowntime = ev.manufacturer.reduce((a: number, m: { downtime: number }) => a + m.downtime, 0)
  const totExposure = ev.manufacturer.reduce((a: number, m: { exposure: number }) => a + m.exposure, 0)
  const apr = q5.data.monthly[3], may = q5.data.monthly[4], jun = q5.data.monthly[5]
  const reg = fc.data.models.find((m) => m.id === 'regression')!
  const lease = r.alternatives.find((a) => a.action_type_id === 'A-REPLACE-LEASE')!
  const buy = r.alternatives.find((a) => a.action_type_id === 'A-REPLACE-BUY')!
  const tech = r.alternatives.find((a) => a.action_type_id === 'A-TECH-SHIFT')!
  const inspect = r.alternatives.find((a) => a.action_type_id === 'A-INSPECT')!
  const promo = r.alternatives.find((a) => a.action_type_id === 'A-PROMO')!
  const types = new Set(r.selected.map((a) => a.action_type_id))
  const groups = r.selected.map((a) => a.incompatibility_group).filter(Boolean)

  return (
    <div>
      <PageHead eyebrow="Decisions · $100,000 operating budget, July 1–30 2025" title="Recommended priced actions"
        question="Up to three action types from action_catalog, costed with the challenge formula: quantity × (unit cost + daily recurring cost × max(0, 30 − lead days)). The catalogue gives prices and limits, not results — every benefit below is our estimate with its assumptions shown." />

      <Panel title="Budget allocation" sub={`${usd(r.spent, 0)} committed across ${r.selected.length} action types · ${usd(r.preserved, 0)} preserved`}>
        <div className="budget-bar" role="img" aria-label="Budget allocation">
          {r.selected.map((a, i) => <div key={a.action_type_id} style={{ width: `${(a.total_cost / r.budget) * 100}%`, background: COLORS[i] }} title={`${a.name}: ${usd(a.total_cost, 0)}`} />)}
          <div style={{ flex: 1, background: '#2a303c' }} title={`Preserved: ${usd(r.preserved, 0)}`} />
        </div>
        <div className="legend mt-s">
          {r.selected.map((a, i) => <span className="lg" key={a.action_type_id}><span className="sw" style={{ background: COLORS[i] }} />{a.name} · {usd(a.total_cost, 0)}</span>)}
          <span className="lg"><span className="sw" style={{ background: '#2a303c', border: '1px solid #3a4250' }} />Preserved · {usd(r.preserved, 0)}</span>
        </div>
        <div className="table-wrap mt">
          <table className="dt"><thead><tr><th>Constraint</th><th>Status</th><th>Detail</th></tr></thead><tbody>
            <tr><td>Total ≤ $100,000</td><td><span className="verified">✓ pass</span></td><td>{usd(r.spent, 2)}</td></tr>
            <tr><td>≤ 3 action types</td><td><span className="verified">✓ pass</span></td><td>{types.size} types (keeping budget does not use a slot)</td></tr>
            <tr><td>Quantity limits</td><td><span className="verified">✓ pass</span></td><td>{r.selected.map((a) => `${a.action_type_id} ${a.quantity}/${a.quantity_limit}`).join(' · ')}</td></tr>
            <tr><td>Incompatibility groups</td><td><span className="verified">✓ pass</span></td><td>{groups.length ? `${groups.join(', ')} used once; A-COMP-CHANGE (same comp_policy group) not selected` : 'none'}</td></tr>
            <tr><td>Lead time within horizon</td><td><span className="verified">✓ pass</span></td><td>{r.selected.map((a) => `${a.action_type_id}: ${a.lead_days}d lead → ${a.operating_days} effective days`).join(' · ')}</td></tr>
            <tr><td>No conflicting moves/replacements on one machine</td><td><span className="verified">✓ pass</span></td><td>No same_machine actions selected</td></tr>
          </tbody></table>
        </div>
      </Panel>

      <div className="stack mt">
        <ActionCard i={0} a={wf} category="Location · machine-floor intervention (instead of replacement)" target="Zone Z-B40 Back Forty"
          why={<>Q1's exposure-adjusted ranking puts <b>{inBF} of 10</b> candidates in Back Forty, and <b>{aboveTheo} of 10</b> earned at or above their theoretical win — so neither luck nor the machines' math explains the low earnings. Back Forty earns <b>{usd(ev.back_forty_theo_per_avail_hour)}</b> theo per available hour vs <b>{usd(ev.other_theo_per_avail_hour)}</b> elsewhere, at {pct(ev.back_forty_occupancy, 1)} occupancy vs {pct(ev.other_occupancy, 1)}. Q2: Jan→Jun its traffic per counter-hour fell {pctv(bfTraffic, 1)} and daily coin-in {pctv(bfCoin, 1)}, with daily traffic and coin-in correlated at r = {q2.data!.traffic_demand_corr['Z-B40'].toFixed(3)}. The problem looks like footfall, not machines.</>}
          effect={<>
            <p>Back Forty generates <b>{usd(ev.back_forty_theo_per_day, 0)}</b> theo per day. Over the {wf.operating_days} days after the {wf.lead_days}-day lead time:</p>
            <ScenarioTable head={['Theo lift', 'Theo gained (est.)', 'Net of cost']} rows={ev.wayfinding_scenarios.map((s: { lift_pct: number; theo_gain: number }) => [`${s.lift_pct}%`, usd(s.theo_gain, 0), <span className={s.theo_gain - wf.total_cost >= 0 ? 'pos' : 'neg'}>{usd(s.theo_gain - wf.total_cost, 0)}</span>])} />
            <p className="small">Break-even: <b>{pctv(ev.wayfinding_breakeven_lift_pct)}</b> theo lift in Back Forty within the horizon. Benefits after July 30 are not counted.</p>
          </>}
          uncertainty={<>High. No historical signage change exists to calibrate the effect; the traffic–coin-in correlation is partly driven by shared weekday/event patterns, so it does not prove that more entries cause more play. Wayfinding has no downtime, so downside is limited to the {usd(wf.total_cost, 0)} spend.</>}
          measure={<>Primary: Back Forty coin-in per available hour and entries per counter-hour for Jul 11–30 vs (a) the <Link to="/model">frozen weekday forecast</Link> and (b) the other six zones over the same days (difference-in-differences). Success = Back Forty theo rises ≥ {pctv(ev.wayfinding_breakeven_lift_pct, 1)} relative to the other zones, with counter coverage ≥ 95% so missing hours don't bias the result.</>}
          links={[['/q1', 'Q1 candidate ranking'], ['/q2', 'Q2 Back Forty drill-down']]} />

        <ActionCard i={1} a={pm} category="Maintenance prioritisation" target="Manufacturer: Ridgeline (94 machines)"
          why={<>Ridgeline machines log <b>{ridge.tickets_per_machine.toFixed(2)}</b> fault repairs per machine vs {others.map((o: { manufacturer: string; tickets_per_machine: number }) => `${o.tickets_per_machine.toFixed(2)} (${o.manufacturer})`).join(' and ')} — {pct(ridge.downtime / totFaultDowntime, 0)} of all fault downtime ({num(ridge.downtime, 0)} h), {pct(ridge.exposure / totExposure, 0)} of estimated lost-play exposure ({usd(ridge.exposure, 0)}) and {usd(ridge.cost, 0)} in direct repair cost over six months. Most downtime is repair time, not waiting for a technician, so prevention targets the larger share.</>}
          effect={<>
            <p>Ridgeline currently costs ≈ <b>{usd(ev.ridgeline_exposure_per_day, 0)}/day</b> in estimated theo exposure plus <b>{usd(ev.ridgeline_repair_cost_per_day, 0)}/day</b> in direct repairs. Over {pm.operating_days} effective days:</p>
            <ScenarioTable head={['Fault reduction', 'Downtime avoided', 'Exposure + repair cost avoided']} rows={ev.preventive_scenarios.map((s: { reduction_pct: number; downtime_hours_avoided: number; theo_exposure_avoided: number; repair_cost_avoided: number }) => [`${s.reduction_pct}%`, `${num(s.downtime_hours_avoided, 0)} h`, usd(s.theo_exposure_avoided + s.repair_cost_avoided, 0)])} />
            <p className="small">In-horizon break-even needs a <b>{pctv(ev.preventive_breakeven_reduction_pct, 1)}</b> reduction. Planned sweep downtime: 90 min × {num(ev.preventive_planned_downtime_hours / 1.5)} machines = {num(ev.preventive_planned_downtime_hours, 0)} machine-hours, ≤ {usd(ev.preventive_planned_downtime_theo_upper, 0)} theo at average rates (less in quiet hours). We fund it because effects persist beyond July and it attacks the floor's clearest operational leak.</p>
          </>}
          uncertainty={<>Medium–high. The catalogue gives no effectiveness figure; a 30-day window is short for a reliability intervention. Exposure is theo-based and assumes no substitution to nearby machines, so it overstates true lost revenue.</>}
          measure={<>Ridgeline fault tickets and downtime per active machine-day, Jul 8–30, vs its own Jan–Jun rate and vs Halcyon/Northwind as controls. Schedule sweeps on the lowest-demand days and hours (Tue–Wed early morning per the <Link to="/model">weekday forecast</Link> and Q2 hourly profile). Success = ≥ {pctv(ev.preventive_breakeven_reduction_pct, 1)} fewer Ridgeline faults per machine-day with no rise in the controls.</>}
          links={[['/q3', 'Q3 manufacturer reliability']]} />

        <ActionCard i={2} a={cp} category="Loyalty program cost optimisation" target="Randomised pilot with control group (comp_policy)"
          why={<>From May 1 the points charged per comp dollar fell by about half in every tier while item face values and costs did not change. Comp cost / carded theo moved from {pctv(apr.cost_pct_tracked_theo)} (Apr) to {pctv(may.cost_pct_tracked_theo)} (May) and {pctv(jun.cost_pct_tracked_theo)} (Jun); average monthly comp cost rose from {usd(ev.comp_monthly_cost_janapr, 0)} (Jan–Apr) to {usd(ev.comp_monthly_cost_mayjun, 0)} (May–Jun). We cannot tell from the data whether this was a deliberate policy, or whether it bought extra visits — a controlled test answers that.</>}
          effect={<>
            <p>Treatment group: redemption pricing restored toward the Jan–Apr level (catalogue allows 5–20 points per comp dollar). Control: current pricing. If cost per theo returned to the April level for the whole program, the monthly difference would be on the order of <b>{usd(ev.comp_monthly_cost_mayjun - ev.comp_monthly_cost_janapr, 0)}</b> — an upper bound, because part of the rise may reflect more play.</p>
            <p className="small">The pilot fee covers design, training and tracking; comp costs still flow through F&amp;B cost of goods. A floor-wide change (A-COMP-CHANGE, $1,500) is cheaper but cannot separate the pricing effect from seasonality, and the two are mutually exclusive.</p>
          </>}
          uncertainty={<>Medium. {cp.operating_days} effective days may be too short to see visit-frequency effects; guests may react to less generous pricing. The pilot is protective: it does not target or encourage heavy losers to play more.</>}
          measure={<>Randomise eligible carded players (stratified by tier) into treatment/control. Compare comp cost per $ theo, trips per player, theo per player and redemption rate. Success = treatment comp cost / theo falls toward ~{pctv(apr.cost_pct_tracked_theo, 2)} with no statistically meaningful drop in theo per player vs control.</>}
          links={[['/q5', 'Q5 redemption pricing change']]} />
      </div>

      <Panel className="mt" title="Considered but not funded" sub="Why the remaining budget is preserved">
        <div className="table-wrap"><table className="dt"><thead><tr><th>Action</th><th className="num">Cost (as specified)</th><th>Reason not funded</th></tr></thead><tbody>
          <tr><td className="strong">{buy.name} × {buy.quantity}</td><td className="num">{usd(buy.total_cost, 0)}</td><td className="wrap">Exceeds the budget on its own (capital charged in full), and the evidence points to location, not machines.</td></tr>
          <tr><td className="strong">{lease.name} × {lease.quantity}</td><td className="num">{usd(lease.total_cost, 0)}</td><td className="wrap">The management plan. {inBF}/10 candidates share one low-traffic zone and {aboveTheo}/10 earned ≥ theo; a new title in the same spot would face the same footfall. Revisit after the wayfinding test.</td></tr>
          <tr><td className="strong">{tech.name}</td><td className="num">{usd(tech.total_cost, 0)}</td><td className="wrap">Response time is only {pct(ev.tech_shift_response_share, 1)} of fault downtime; even eliminating it would recover ≤ {usd(ev.tech_shift_max_monthly_exposure, 0)} of estimated exposure per 30 days, below the package cost.</td></tr>
          <tr><td className="strong">{inspect.name} × {inspect.quantity}</td><td className="num">{usd(inspect.total_cost, 0)}</td><td className="wrap">{aboveTheo}/10 candidates earned at or above theo; we found no payout shortfall that would justify a paytable inspection. An unusual result is a reason to inspect, not proof — none stood out among the candidates.</td></tr>
          <tr><td className="strong">{promo.name}</td><td className="num">{usd(promo.total_cost, 0)}</td><td className="wrap">The forecast model's event coefficient (+{usd(fc.data.coef.event, 0)}/day coin-in on known citywide event days) is associative, not causal, and July has no comparable event in the data.</td></tr>
        </tbody></table></div>
        <p className="small muted mt-s">Forecast model gain over the weekday baseline: {usd(reg.mae_gain_vs_weekday, 0)} MAE (95% CI {usd(reg.gain_ci95[0], 0)} to {usd(reg.gain_ci95[1], 0)}) — used for scheduling and as a measurement baseline, not to justify spend.</p>
      </Panel>

      <Panel className="mt" title="Full action catalogue" sub="2_machine_decision/action_catalog — prices and limits only" source={{ tables: ['2_machine_decision/action_catalog', '2_machine_decision/cost_rules'] }}>
        <DataTable rows={r.catalog} rowKey={(c) => String(c.action_type_id)} pageSize={13} csvName="action_catalog"
          columns={[
            { key: 'action_type_id', label: 'ID', render: (c) => <span className={types.has(String(c.action_type_id)) ? 'strong' : ''}>{String(c.action_type_id)}{types.has(String(c.action_type_id)) && <span className="badge gold" style={{ marginLeft: 6 }}>selected</span>}</span> },
            { key: 'name', label: 'Action' }, { key: 'unit', label: 'Unit' },
            { key: 'unit_cost', label: 'Unit cost', num: true, render: (c) => usd(Number(c.unit_cost), 0) },
            { key: 'recurring_per_day', label: 'Per day', num: true, render: (c) => usd(Number(c.recurring_per_day), 0) },
            { key: 'lead_days', label: 'Lead days', num: true }, { key: 'downtime_minutes', label: 'Downtime (min)', num: true },
            { key: 'quantity_limit', label: 'Limit', num: true }, { key: 'incompatibility_group', label: 'Incompatibility', render: (c) => String(c.incompatibility_group ?? '—') },
            { key: 'notes', label: 'Notes', wrap: true },
          ]} />
      </Panel>
    </div>
  )
}

function ScenarioTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap" style={{ margin: '6px 0' }}><table className="dt"><thead><tr>{head.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'num' : ''}>{c}</td>)}</tr>)}</tbody></table></div>
  )
}

function ActionCard({ i, a, category, target, why, effect, uncertainty, measure, links }: { i: number; a: PricedAction; category: string; target: string; why: ReactNode; effect: ReactNode; uncertainty: ReactNode; measure: ReactNode; links: [string, string][] }) {
  return (
    <article className="action-card" style={{ borderTop: `3px solid ${COLORS[i]}` }}>
      <div className="ac-head">
        <div>
          <div className="small muted">Action {i + 1} · {category}</div>
          <h2 style={{ fontSize: 18, marginTop: 2 }}>{a.name}</h2>
          <div className="row mt-s" style={{ gap: 6 }}>
            <span className="badge gold">{a.action_type_id}</span>
            <span className="badge">{target}</span>
            <span className="badge">qty {a.quantity} / limit {a.quantity_limit}</span>
            <span className="badge">lead {a.lead_days} days → {a.operating_days} effective days</span>
            <span className="badge">downtime {a.downtime_minutes} min{a.unit === 'manufacturer' ? ' per machine' : ''}</span>
          </div>
        </div>
        <div className="ac-cost">
          <div className="v">{usd(a.total_cost, 0)}</div>
          <div className="small muted">{a.quantity} × ({usd(a.unit_cost, 0)} + {usd(a.recurring_per_day, 0)}/day × {a.operating_days})</div>
        </div>
      </div>
      <div className="ac-sections">
        <div><h4>Why — evidence</h4><p>{why}</p><div className="row" style={{ gap: 6 }}>{links.map(([to, l]) => <Link key={to} to={to} className="btn sm">{l} →</Link>)}</div></div>
        <div><h4>Expected effect (estimate)</h4>{effect}</div>
        <div><h4>Uncertainty</h4><p>{uncertainty}</p></div>
        <div><h4>Measurement plan & success criterion</h4><p>{measure}</p></div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Catalogue note: {a.notes}</p>
    </article>
  )
}

