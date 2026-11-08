import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import type { ForecastData, PricedAction, Q1Data, Q2Data, Q3Data, Q5Data, RecsData } from '../lib/types'
import { scoreMachines } from '../lib/q1'
import { mLabel, num, pct, pctv, usd } from '../lib/format'
import { Callout, Kpi, Loading, PageHead, Panel } from '../components/ui'
import { DataTable } from '../components/DataTable'
import { SERIES } from '../components/chart'

const COLORS = [SERIES[0], SERIES[2], SERIES[6]]
const MAX_ACTION_TYPES = 3 // GUIDE.md §6: up to 3 action types; keeping money does not use a slot.

/** Q6 — which actions to fund with $100,000, and how we would know they worked. */
export default function Recommendations() {
  const recs = useData<RecsData>('recommendations')
  const q1 = useData<Q1Data>('q1')
  const q2 = useData<Q2Data>('q2')
  const q3 = useData<Q3Data>('q3')
  const q5 = useData<Q5Data>('q5')
  const fc = useData<ForecastData>('forecast')
  const top10 = useMemo(() => (q1.data ? scoreMachines(q1.data, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'], 181).filter((m) => m.rank !== null && m.rank <= 10) : []), [q1.data])

  if (!recs.data || !q1.data || !q2.data || !q3.data || !q5.data || !fc.data) return <Loading error={recs.error || q1.error || q3.error} />
  const r = recs.data
  const ev = r.evidence
  const s3 = q3.data.summary as Record<string, number>
  const byId = (id: string) => r.selected.find((a) => a.action_type_id === id)!
  const alt = (id: string) => r.alternatives.find((a) => a.action_type_id === id)!
  const tech = byId('A-TECH-SHIFT'), inspect = byId('A-INSPECT'), pilot = byId('A-COMP-PILOT')

  // Every displayed total is recomputed from the official catalogue rather than trusted.
  const catalog = new Map(r.catalog.map((c) => [String(c.action_type_id), c]))
  const recomputed = r.selected.map((a) => {
    const c = catalog.get(a.action_type_id)!
    const days = Math.max(0, r.horizon_days - Number(c.lead_days))
    return a.quantity * (Number(c.unit_cost_cents) + Number(c.recurring_cost_cents_per_day) * days) / 100
  })
  const invested = recomputed.reduce((x, y) => x + y, 0)
  const preserved = r.budget - invested
  const costsMatchCatalog = r.selected.every((a, i) => Math.abs(a.total_cost - recomputed[i]) < 0.005 && a.unit_cost === Number(catalog.get(a.action_type_id)!.unit_cost))
  const groups = r.selected.map((a) => a.incompatibility_group).filter(Boolean)
  const types = new Set(r.selected.map((a) => a.action_type_id))
  const checks: [string, boolean, string][] = [
    ['Costs match action_catalog', costsMatchCatalog, r.selected.map((a, i) => `${a.action_type_id} ${a.quantity} × ${usd(a.unit_cost, 0)} = ${usd(recomputed[i], 0)}`).join(' · ')],
    ['Invested + preserved = $100,000', Math.abs(invested + preserved - r.budget) < 0.005 && Math.abs(invested - r.spent) < 0.005 && Math.abs(preserved - r.preserved) < 0.005, `${usd(invested, 0)} + ${usd(preserved, 0)} = ${usd(invested + preserved, 0)}`],
    [`≤ ${MAX_ACTION_TYPES} action types`, types.size <= MAX_ACTION_TYPES, `${types.size} types; keeping the remaining ${usd(preserved, 0)} (A-HOLD) does not use a slot`],
    ['Quantity limits', r.selected.every((a) => a.quantity <= a.quantity_limit), r.selected.map((a) => `${a.action_type_id} ${a.quantity}/${a.quantity_limit}`).join(' · ')],
    ['Incompatibility groups', new Set(groups).size === groups.length, groups.length ? `${groups.join(', ')} used once; A-COMP-CHANGE (same group) not selected` : 'none used'],
    [`Lead time inside the ${r.horizon_days}-day horizon`, r.selected.every((a) => a.operating_days > 0), r.selected.map((a) => `${a.action_type_id}: ${a.lead_days}d lead → ${a.operating_days} days`).join(' · ')],
  ]
  const allPass = checks.every((c) => c[1])

  // Context from Q1–Q5, recomputed from their datasets.
  const coinByMonth = [...new Set(q2.data.zone_month.map((z) => z.month))].sort().map((m) => ({ m, coin: q2.data!.zone_month.filter((z) => z.month === m).reduce((x, z) => x + z.coin_in, 0) }))
  const first = coinByMonth[0], last = coinByMonth[coinByMonth.length - 1]
  const peak = coinByMonth.reduce((a, b) => (b.coin > a.coin ? b : a))
  const low = coinByMonth.reduce((a, b) => (b.coin < a.coin ? b : a))
  const inBF = top10.filter((m) => m.period_zone === 'Z-B40').length
  const aboveTheo = top10.filter((m) => m.luck > 0).length
  const lease = alt('A-REPLACE-LEASE'), buy = alt('A-REPLACE-BUY'), wf = alt('A-WAYFINDING'), pm = alt('A-PREVENTIVE'), promo = alt('A-PROMO'), change = alt('A-COMP-CHANGE')

  return (
    <div>
      <PageHead eyebrow={`Q6 · $100,000 budget · ${r.horizon_days} days from July 1, 2025`} title="Which actions would we fund with $100,000, and how would we know they worked?"
        question={<>The challenge allows up to {MAX_ACTION_TYPES} action types from <code>action_catalog</code> over the {r.horizon_days} days from July 1, or keeping the money. Costs use the challenge formula: quantity × (unit cost + daily recurring cost × max(0, {r.horizon_days} − lead days)). The catalogue gives prices and limits, not results — each action below is a test with a measurement plan, not a guaranteed outcome.</>} />

      <div className="kpis">
        <Kpi label="Total budget" value={usd(r.budget, 0)} sub={`${r.horizon_days} days from July 1, 2025`} tip="GUIDE.md §6: a pretend $100,000 for the 30 days from July 1, 2025." />
        <Kpi label="Invested" value={usd(invested, 0)} verified={allPass} sub={`${r.selected.length} action types`} tip="Σ quantity × official unit cost, recomputed from action_catalog on this page." />
        <Kpi label="Preserved (A-HOLD)" value={usd(preserved, 0)} verified={allPass} sub={`${pct(preserved / r.budget, 1)} of budget`} tip="A-HOLD has a $0 unit cost: it keeps money unspent and does not use an action slot." />
        <Kpi label="Action types used" value={`${types.size} / ${MAX_ACTION_TYPES}`} verified={allPass} sub="Keeping money uses no slot" />
      </div>

      <Panel className="mt" title="Budget allocation" sub={`${usd(invested, 0)} invested across ${types.size} action types · ${usd(preserved, 0)} preserved`} source={{ tables: ['2_machine_decision/action_catalog'] }}>
        <div className="budget-bar" role="img" aria-label={`Budget allocation: ${r.selected.map((a) => `${a.action_type_id} ${usd(a.total_cost, 0)}`).join(', ')}, preserved ${usd(preserved, 0)}`}>
          {r.selected.map((a, i) => <div key={a.action_type_id} style={{ width: `${(a.total_cost / r.budget) * 100}%`, background: COLORS[i] }} title={`${a.name}: ${usd(a.total_cost, 0)}`} />)}
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.08)' }} title={`Preserved: ${usd(preserved, 0)}`} />
        </div>
        <div className="legend mt-s">
          {r.selected.map((a, i) => <span className="lg" key={a.action_type_id}><span className="sw" style={{ background: COLORS[i] }} />{a.action_type_id} · {usd(a.total_cost, 0)}</span>)}
          <span className="lg"><span className="sw" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }} />A-HOLD (preserved) · {usd(preserved, 0)}</span>
        </div>

        <div className="table-wrap mt">
          <table className="dt"><thead><tr><th>Action</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Total</th><th className="num">Days of effect</th><th>Why</th></tr></thead><tbody>
            <tr><td className="strong">A-TECH-SHIFT<div className="small muted">{tech.name}</div></td><td className="num">{tech.quantity}</td><td className="num">{usd(tech.unit_cost, 0)}</td><td className="num">{usd(tech.total_cost, 0)}</td><td className="num">{tech.operating_days}</td><td className="wrap">Test whether more repair staffing cuts response time and downtime ({num(s3.tickets)} operations tickets, {num(s3.fault_repairs)} of them fault repairs).</td></tr>
            <tr><td className="strong">A-INSPECT<div className="small muted">{inspect.name}</div></td><td className="num">{inspect.quantity}</td><td className="num">{usd(inspect.unit_cost, 0)}</td><td className="num">{usd(inspect.total_cost, 0)}</td><td className="num">{inspect.operating_days}</td><td className="wrap">Check the {top10.length} Q1 candidates ({inBF} in Back Forty) for faults and paytable issues before any costly move or replacement.</td></tr>
            <tr><td className="strong">A-COMP-PILOT<div className="small muted">{pilot.name}</div></td><td className="num">{pilot.quantity}</td><td className="num">{usd(pilot.unit_cost, 0)}</td><td className="num">{usd(pilot.total_cost, 0)}</td><td className="num">{pilot.operating_days}</td><td className="wrap">Test comp redemption pricing against a randomised control group.</td></tr>
            <tr><td className="strong">A-HOLD<div className="small muted">Preserve budget</div></td><td className="num">1</td><td className="num">{usd(0, 0)}</td><td className="num">{usd(preserved, 0)} kept</td><td className="num">—</td><td className="wrap">No evidence yet justifies a larger spend; release funds only when these tests support it.</td></tr>
            <tr><td className="strong">Total</td><td /><td /><td className="num strong">{usd(r.budget, 0)}</td><td /><td className="small muted">{usd(invested, 0)} invested + {usd(preserved, 0)} preserved</td></tr>
          </tbody></table>
        </div>

        <div className="table-wrap mt">
          <table className="dt"><thead><tr><th>Rule check (computed on this page)</th><th>Status</th><th>Detail</th></tr></thead><tbody>
            {checks.map(([name, ok, detail]) => <tr key={name}><td>{name}</td><td>{ok ? <span className="verified">✓ pass</span> : <span className="neg">✗ fail</span>}</td><td className="wrap">{detail}</td></tr>)}
          </tbody></table>
        </div>
      </Panel>

      <Callout title="Important qualifications" tone="warn">
        <b>Downtime hours are not automatically lost revenue</b> — players can move to a nearby machine, so theo-based exposure overstates what was lost.
        {' '}<b>Fluctuating coin-in does not prove a comp change will raise it</b> — coin-in moved between {usd(low.coin / 1e6, 2)}M and {usd(peak.coin / 1e6, 2)}M a month with no steady trend.
        {' '}These actions are <b>hypotheses to test, not guaranteed outcomes</b>, and {r.horizon_days} days is a short window: effects after July 30 are not counted.
      </Callout>

      <div className="stack mt">
        <ActionCard i={0} a={tech} category="Downtime · repair staffing" target="Highest-volume repair shift"
          why={<>Q3 recorded <b>{num(s3.tickets)} operations tickets</b>, of which <b>{num(s3.fault_repairs)} were fault repairs</b>, and <b>{num(s3.downtime_hours_all, 2)} downtime hours</b> in total ({num(s3.downtime_hours_fault, 2)} h from faults). A fault repair averaged <b>{s3.avg_response_fault.toFixed(2)} h</b> waiting for a technician and <b>{s3.avg_repair_fault.toFixed(2)} h</b> being repaired. An extra technician should shorten the wait.</>}
          effect={<>
            <p>Waiting for a technician is <b>{pct(ev.tech_shift_response_share, 1)}</b> of fault downtime. Even eliminating it entirely would recover at most about <b>{usd(ev.tech_shift_max_monthly_exposure, 0)}</b> of <i>estimated</i> theo exposure per 30 days — less than the {usd(tech.total_cost, 0)} cost.</p>
            <p className="small">So this is funded as a <b>measured test</b> of whether staffing cuts response time and downtime, not as an investment expected to pay back within the horizon. The catalogue covers one technician, 8 h × 30 days.</p>
          </>}
          uncertainty={<>Medium. One technician on one shift may not move floor-wide averages, and repair duration ({s3.avg_repair_fault.toFixed(2)} h average) is the larger share of downtime, which staffing affects less directly.</>}
          measure={<>For Jul 8–30 ({tech.operating_days} days), compare <b>average response time</b>, <b>repair duration</b> and <b>fault downtime hours per active machine-day</b> on the staffed shift with (a) the same shift and weekdays in the Jan–Jun baseline and (b) unchanged shifts over the same days. Success = response time on the staffed shift falls below its Jan–Jun average ({s3.avg_response_fault.toFixed(2)} h for fault repairs) while unchanged shifts do not improve similarly.</>}
          links={[['/q3', 'Q3 maintenance']]} />

        <ActionCard i={1} a={inspect} category="Payout settings and faults · verification before larger decisions" target={`${top10.length} Q1 candidates: ${top10.map((m) => m.machine_id).join(', ')}`}
          why={<>Q1's ranking found <b>{inBF} of {top10.length}</b> preliminary underperformers in <b>Back Forty</b>. Before spending on relocation or replacement — leasing {lease.quantity} new titles would cost {usd(lease.total_cost, 0)}, buying {buy.quantity} would cost {usd(buy.total_cost, 0)} — inspections confirm each machine's paytable and fault state.</>}
          effect={<>
            <p>The outcome is <b>information</b>, not revenue: the catalogue states "{inspect.notes}" {aboveTheo} of {top10.length} candidates earned at or above their theoretical win, so we do not expect a payout fault. Finding none is a valid result that rules out payout settings and supports location as the cause.</p>
          </>}
          uncertainty={<>Low cost, low risk: {inspect.downtime_minutes} minutes of downtime per machine, scheduled in quiet hours (early-week mornings per the <Link to="/model">weekday forecast</Link>).</>}
          measure={<>Count of <b>faults and paytable discrepancies found and corrected</b> across the {inspect.quantity} machines, then their <b>availability</b> for the rest of July compared with their own Jan–Jun availability and with uninspected Back Forty machines. Success = a clear go/no-go on whether relocating or replacing these machines is justified.</>}
          links={[['/q1', 'Q1 candidate ranking'], ['/q2', 'Q2 Back Forty']]} />

        <ActionCard i={2} a={pilot} category="Comps · controlled policy test" target="Randomised treatment and control groups (comp_policy)"
          why={<>From May 1 the points charged per comp dollar fell by about half in every tier (Q5). Average monthly comp cost moved from {usd(ev.comp_monthly_cost_janapr, 0)} (Jan–Apr) to {usd(ev.comp_monthly_cost_mayjun, 0)} (May–Jun). Floor coin-in <b>fluctuated rather than declined steadily</b>: {coinByMonth.map((c) => `${mLabel(c.m)} ${usd(c.coin / 1e6, 2)}M`).join(', ')} — {mLabel(first.m)} to {mLabel(last.m)} {pctv((last.coin / first.coin - 1) * 100, 1)}. The data cannot tell us whether cheaper comps bought extra visits; only a controlled test can.</>}
          effect={<>
            <p>The treatment group gets redemption pricing restored toward the Jan–Apr level (the catalogue allows 5–20 points per comp dollar); the control group keeps current pricing. The pilot fee covers design, training and tracking; comp costs still flow through F&amp;B cost of goods.</p>
            <p className="small">A floor-wide change (A-COMP-CHANGE, {usd(change.total_cost, 0)}) is cheaper but cannot separate the pricing effect from seasonality, and the two are mutually exclusive.</p>
          </>}
          uncertainty={<>Medium. {pilot.operating_days} days may be too short to see changes in visit frequency, and guests may react to less generous pricing. The pilot does not target or encourage heavy losers to play more.</>}
          measure={<>Randomise eligible carded players, stratified by tier, into treatment and control. Compare <b>incremental net revenue</b> (theo minus comp cost per player) and <b>repeat visits</b> (trips per player) between the groups over the {pilot.operating_days} days. Success = treatment comp cost per $ theo falls with no meaningful drop in visits or theo per player versus control.</>}
          links={[['/q5', 'Q5 loyalty'], ['/q2', 'Q2 demand']]} />
      </div>

      <Panel className="mt" title="How we will know it worked" sub={`${r.horizon_days}-day evaluation, July 1–30 2025, against Jan–Jun baselines and control groups`}>
        <div className="table-wrap"><table className="dt"><thead><tr><th>Action</th><th>Measure</th><th>Baseline</th><th>Comparison group</th></tr></thead><tbody>
          <tr><td className="strong">A-TECH-SHIFT</td><td className="wrap">Response time, repair duration, fault downtime hours</td><td className="wrap">Same shift and weekdays, Jan–Jun</td><td className="wrap">Unchanged shifts over the same days</td></tr>
          <tr><td className="strong">A-INSPECT</td><td className="wrap">Faults and paytable issues found and corrected; later availability</td><td className="wrap">The machines' own Jan–Jun availability</td><td className="wrap">Uninspected Back Forty machines</td></tr>
          <tr><td className="strong">A-COMP-PILOT</td><td className="wrap">Incremental net revenue per player; repeat visits</td><td className="wrap">Jan–Jun comp cost and trips per player</td><td className="wrap">Randomised control group on current pricing</td></tr>
          <tr><td className="strong">A-HOLD</td><td className="wrap">{usd(preserved, 0)} released only when a test supports another investment</td><td className="wrap">—</td><td className="wrap">—</td></tr>
        </tbody></table></div>
        <p className="small muted mt-s">Each test runs only after its catalogue lead time. Floor-level coin-in is judged against the <Link to="/model">frozen forecast</Link> rather than against June alone, because monthly coin-in fluctuated.</p>
      </Panel>

      <Panel className="mt" title="Considered but not funded" sub={`Why ${usd(preserved, 0)} is preserved`}>
        <div className="table-wrap"><table className="dt"><thead><tr><th>Action</th><th className="num">Cost (as specified)</th><th>Reason not funded</th></tr></thead><tbody>
          <tr><td className="strong">{buy.name} × {buy.quantity}</td><td className="num">{usd(buy.total_cost, 0)}</td><td className="wrap">Exceeds the budget on its own (capital charged in full), and the evidence points to location rather than the machines.</td></tr>
          <tr><td className="strong">{lease.name} × {lease.quantity}</td><td className="num">{usd(lease.total_cost, 0)}</td><td className="wrap">{inBF}/{top10.length} candidates share one low-traffic zone and {aboveTheo}/{top10.length} earned at least theo; a new title in the same spot would face the same footfall. Revisit after the inspections.</td></tr>
          <tr><td className="strong">{wf.name}</td><td className="num">{usd(wf.total_cost, 0)}</td><td className="wrap">Location is the leading explanation for Back Forty, but only {MAX_ACTION_TYPES} action types are allowed. Inspecting first rules out machine causes before spending on location.</td></tr>
          <tr><td className="strong">{pm.name}</td><td className="num">{usd(pm.total_cost, 0)}</td><td className="wrap">Ridgeline faults are concentrated (Q3), but the {MAX_ACTION_TYPES}-type limit applies; the technician test addresses downtime this month. A candidate for the next horizon.</td></tr>
          <tr><td className="strong">{promo.name}</td><td className="num">{usd(promo.total_cost, 0)}</td><td className="wrap">The forecast's event coefficient (+{usd(fc.data.coef.event, 0)}/day coin-in on known citywide event days) is associative, not causal, and July has no comparable event in the data.</td></tr>
          <tr><td className="strong">{change.name}</td><td className="num">{usd(change.total_cost, 0)}</td><td className="wrap">Mutually exclusive with the pilot (same comp_policy group) and cannot separate the pricing effect from seasonality.</td></tr>
        </tbody></table></div>
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
            <span className="badge">downtime {a.downtime_minutes} min{a.unit === 'machine' ? ' per machine' : ''}</span>
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
        <div><h4>Measurement plan &amp; success criterion</h4><p>{measure}</p></div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Catalogue note: {a.notes}</p>
    </article>
  )
}
