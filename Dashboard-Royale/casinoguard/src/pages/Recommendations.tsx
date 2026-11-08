import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import type { ForecastData, PricedAction, Q1Data, Q2Data, Q3Data, RecsData, Scenarios } from '../lib/types'
import { dLabel, num, pct, signedPct, usd } from '../lib/format'
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
  const fc = useData<ForecastData>('forecast')

  if (!recs.data || !q1.data || !q2.data || !q3.data || !fc.data) return <Loading error={recs.error || q1.error || q2.error || q3.error || fc.error} />
  const r = recs.data
  const ev = r.evidence
  const byId = (id: string) => r.selected.find((a) => a.action_type_id === id)!
  const alt = (id: string) => r.alternatives.find((a) => a.action_type_id === id)!
  const s3 = q3.data.summary as Record<string, number>
  const inspect = byId('A-INSPECT'), wayf = byId('A-WAYFINDING'), pilot = byId('A-COMP-PILOT')
  const plan = r.plan
  const pi = plan['A-INSPECT'], pw = plan['A-WAYFINDING'], pp = plan['A-COMP-PILOT']
  const dg = q1.data.diagnostics
  const dec = fc.data.decisions
  const zn = Object.fromEntries(q2.data.zones.map((z) => [z.zone_id, z.zone_name]))
  const closure = q2.data.closures.find((c) => c.walkway_id === pw.walkway_id)
  const flagged = pi.targets.filter((t) => t.payout_verdict === 'payout anomaly lead')

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

  const tech = alt('A-TECH-SHIFT'), pm = alt('A-PREVENTIVE'), lease = alt('A-REPLACE-LEASE'), buy = alt('A-REPLACE-BUY'), promo = alt('A-PROMO'), change = alt('A-COMP-CHANGE')
  const why = (id: string) => ({
    'A-INSPECT': `Q1 payout test: ${flagged.map((t) => t.machine_id).join(', ') || 'no machine'} flagged after correction; the next ${pi.targets.length - flagged.length} lowest z-scores on the floor are checked in the same visit.`,
    'A-WAYFINDING': `Q2: ${zn[pw.zone_id]} stayed ${Math.abs(pw.did_after_pp).toFixed(1)} pp below the rest of the floor after the ${pw.walkway_id} walkway reopened.`,
    'A-COMP-PILOT': 'Q5: points per comp dollar halved on May 1 and monthly comp cost rose; only a randomised test separates pricing from season.',
  } as Record<string, string>)[id] ?? ''

  return (
    <div>
      <PageHead eyebrow={`Q6 · $100,000 budget · ${r.horizon_days} days from July 1, 2025`} title="Which actions would we fund with $100,000, and how would we know they worked?"
        question={<>Each funded action answers one cause the analysis found — a <b>payout lead</b> (Q1), a <b>location loss</b> after the walkway closure (Q2) and a <b>comp pricing change</b> (Q5). Costs use the challenge formula: quantity × (unit cost + daily recurring cost × max(0, {r.horizon_days} − lead days)). The catalogue gives prices, not results: benefits below are scenarios computed from the data, with a break-even point for each.</>} />

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
          <table className="dt"><thead><tr><th>Action</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Total</th><th className="num">Days of effect</th><th className="num">Break-even</th><th>Why</th></tr></thead><tbody>
            {r.selected.map((a) => (
              <tr key={a.action_type_id}><td className="strong">{a.action_type_id}<div className="small muted">{a.name}</div></td><td className="num">{a.quantity}</td><td className="num">{usd(a.unit_cost, 0)}</td>
                <td className="num">{usd(a.total_cost, 0)}</td><td className="num">{a.operating_days}</td>
                <td className="num">{Number.isFinite(plan[a.action_type_id as keyof typeof plan].break_even_pct) ? `${plan[a.action_type_id as keyof typeof plan].break_even_pct.toFixed(0)}% of full benefit` : 'n/a'}</td>
                <td className="wrap">{why(a.action_type_id)}</td></tr>
            ))}
            <tr><td className="strong">A-HOLD<div className="small muted">Preserve budget</div></td><td className="num">1</td><td className="num">{usd(0, 0)}</td><td className="num">{usd(preserved, 0)} kept</td><td className="num">—</td><td /><td className="wrap">Replacements and larger spends wait for these tests: none of the evidence supports them yet.</td></tr>
            <tr><td className="strong">Total</td><td /><td /><td className="num strong">{usd(r.budget, 0)}</td><td /><td /><td className="small muted">{usd(invested, 0)} invested + {usd(preserved, 0)} preserved</td></tr>
          </tbody></table>
        </div>

        <div className="table-wrap mt">
          <table className="dt"><thead><tr><th>Rule check (computed on this page)</th><th>Status</th><th>Detail</th></tr></thead><tbody>
            {checks.map(([name, ok, detail]) => <tr key={name}><td>{name}</td><td>{ok ? <span className="verified">✓ pass</span> : <span className="neg">✗ fail</span>}</td><td className="wrap">{detail}</td></tr>)}
          </tbody></table>
        </div>
      </Panel>

      <Callout title="How to read the scenarios" tone="warn">
        Benefits are in <b>theoretical win (expected house win)</b> or comp cost saved, over the days left after each lead time — not profit, and nothing after July 30 is counted.
        {' '}<b>Low</b> assumes the action does nothing; <b>base</b> and <b>high</b> use effect sizes measured in the data. <b>Break-even</b> is the share of the high-scenario benefit needed to recover the cost.
        {' '}These are hypotheses to test, not guaranteed outcomes.
      </Callout>

      <div className="stack mt">
        <ActionCard i={0} a={inspect} category="Payout settings · verify before acting" target={pi.targets.map((t) => t.machine_id).join(', ')}
          why={<>The Q1 payout test compares each machine's hold with what its configuration predicts, using the game's own payout variance and spin count. {flagged.length ? <><b>{flagged.map((t) => `${t.machine_id} (z = ${t.z.toFixed(2)})`).join(', ')}</b> {flagged.length > 1 ? 'pass' : 'passes'} the threshold corrected for {dg.tests} machines (|z| ≥ {dg.z_flag.toFixed(2)}).</> : 'No machine passes the corrected threshold.'} The other targets are the next-lowest z-scores still on the floor; one inspection visit covers all five.</>}
          effect={<>
            <ScenarioTable s={pi.scenarios} cost={pi.cost_with_downtime} costNote={`${usd(inspect.total_cost, 0)} + ${usd(pi.cost_with_downtime - inspect.total_cost, 0)} theo lost to ${inspect.downtime_minutes}-minute inspections`} />
            <div className="table-wrap mt-s"><table className="dt"><thead><tr><th>Machine</th><th>Zone</th><th className="num">Expected / observed hold</th><th className="num">z</th><th className="num">Shortfall per day</th></tr></thead>
              <tbody>{pi.targets.map((t) => <tr key={t.machine_id}><td className="strong">{t.machine_id}</td><td>{zn[t.zone_id]}</td><td className="num">{pct(t.exp_hold)} / {pct(t.obs_hold)}</td><td className={`num ${t.payout_verdict === 'payout anomaly lead' ? 'neg' : ''}`}>{t.z.toFixed(2)}</td><td className="num">{usd(t.daily_shortfall, 0)}</td></tr>)}</tbody></table></div>
            <p className="small mt-s">Break-even: {pi.break_even_pct.toFixed(0)}% of the five machines' combined shortfall must be a real, fixable fault.</p>
          </>}
          uncertainty={<>High for the four unflagged machines, whose gaps are within normal luck; moderate for {flagged.map((t) => t.machine_id).join(', ') || 'the flagged machine'}. Finding nothing is a valid result: it rules out payout settings before any replacement is considered. No wrongdoing is implied.</>}
          measure={<>Record paytable and meter checks per machine. For corrected machines, compare observed hold over the rest of July with the configured hold and with each machine's Jan–Jun hold. Inspections run on the quietest forecast days ({dec.quiet_days['A-INSPECT'].map(dLabel).join(', ')}), so the {inspect.downtime_minutes}-minute downtime costs least. Success = a confirmed and corrected fault, or a documented clean result.</>}
          links={[['/q1', 'Q1 leak check']]} />

        <ActionCard i={1} a={wayf} category="Location · restore traffic after the walkway closure" target={zn[pw.zone_id]}
          why={<>{closure ? <>While the {pw.walkway_id} walkway was closed ({dLabel(closure.windows.during[0])}–{dLabel(closure.windows.during[1])}), {zn[pw.zone_id]} coin-in fell {signedPct(closure.zones[pw.zone_id].chg_during_pct, 1)} and its traffic {signedPct(closure.zones[pw.zone_id].traffic_chg_during_pct, 1)}. After reopening it stayed <b>{Math.abs(pw.did_after_pp).toFixed(1)} pp below</b> the rest of the floor: about {usd(pw.gap_theo_per_day, 0)} of theo per day that guests have not come back for.</> : null} Half of the Q1 candidates are only weak because they stand there.</>}
          effect={<>
            <ScenarioTable s={pw.scenarios} cost={wayf.total_cost} />
            <p className="small mt-s">Break-even: the signs must recover {pw.break_even_pct.toFixed(0)}% of the remaining gap during the {wayf.operating_days} days after installation.</p>
          </>}
          uncertainty={<>Medium. Signage effects are not in the data; the gap may also be habit that fades on its own, which is why the comparison is against other zones over the same days.</>}
          measure={<>From install (day {wayf.lead_days + 1}) to July 30, compare {zn[pw.zone_id]} entries per counter-hour and coin-in per day with its pre-closure level, net of the other zones (difference-in-differences, as in Q2). The frozen forecast shows why it is measured at zone level: the best-case effect is {dec.wayfinding_high_effect_floor_pct.toFixed(2)}% of floor coin-in, below the ~{dec.min_detectable_pct['A-WAYFINDING'].toFixed(1)}% the forecast can detect over {wayf.operating_days} days. Success = the zone's gap to the rest of the floor narrows by at least the break-even share.</>}
          links={[['/q2', 'Q2 closure analysis']]} />

        <ActionCard i={2} a={pilot} category="Comps · controlled pricing test" target="Randomised treatment and control groups"
          why={<>From May 1 the points charged per comp dollar halved in every tier (Q5). Monthly comp cost moved from {usd(pp.comp_month_janapr, 0)} (Jan–Apr) to {usd(pp.comp_month_mayjun, 0)} (May–Jun). Whether cheaper comps bought extra visits cannot be read from the data: only a controlled test separates pricing from season.</>}
          effect={<>
            <ScenarioTable s={pp.scenarios} cost={pilot.total_cost} />
            <p className="small mt-s"><b>Does not pay back within {r.horizon_days} days</b> (break-even {Number.isFinite(pp.break_even_pct) ? `${pp.break_even_pct.toFixed(0)}%` : 'n/a'} of the high scenario). It is funded for the decision it informs: if reverting the May pricing floor-wide is right, it is worth up to <b>{usd(pp.annual_policy_value, 0)} a year</b> in comp cost — outside this horizon and not counted above.</p>
          </>}
          uncertainty={<>Medium. {pilot.operating_days} days may be too short to see changes in visit frequency, and guests may react to less generous pricing. The pilot does not target or encourage heavy losers to play more.</>}
          measure={<>Randomise eligible carded players, stratified by tier, into treatment ({pct(pp.treatment_share, 0)}) and control. Compare comp cost per $ of theo and trips per player between the groups over the {pilot.operating_days} days. Success = treatment comp cost per $ theo falls with no meaningful drop in visits or theo per player versus control.</>}
          links={[['/q5', 'Q5 loyalty']]} />
      </div>

      <Panel className="mt" title="Considered but not funded" sub={`Why ${usd(preserved, 0)} is preserved`}>
        <div className="table-wrap"><table className="dt"><thead><tr><th>Action</th><th className="num">Cost (as specified)</th><th>Reason not funded</th></tr></thead><tbody>
          <tr><td className="strong">{tech.name}</td><td className="num">{usd(tech.total_cost, 0)}</td><td className="wrap">Waiting for a technician is {pct(ev.tech_shift_response_share, 1)} of fault downtime ({num(s3.downtime_hours_fault, 0)} h in Jan–Jun). Removing all of it would recover at most {usd(ev.tech_shift_max_monthly_exposure, 0)} of estimated theo per 30 days — less than the cost.</td></tr>
          <tr><td className="strong">{pm.name}</td><td className="num">{usd(pm.total_cost, 0)}</td><td className="wrap">Ridgeline faults are concentrated (Q3), but it breaks even only if faults fall {Number(ev.preventive_breakeven_reduction_pct).toFixed(0)}% within {pm.operating_days} days; the 3-type limit goes to actions with clearer causes. A candidate for the next horizon.</td></tr>
          <tr><td className="strong">{lease.name} × {lease.quantity}</td><td className="num">{usd(lease.total_cost, 0)}</td><td className="wrap">{dg.candidates_location} of the 10 candidates are ordinary for their zone, and none is a payout outlier; a new title in the same spot would face the same footfall. Revisit after the signage test.</td></tr>
          <tr><td className="strong">{buy.name} × {buy.quantity}</td><td className="num">{usd(buy.total_cost, 0)}</td><td className="wrap">Exceeds the budget on its own (capital charged in full).</td></tr>
          <tr><td className="strong">{promo.name}</td><td className="num">{usd(promo.total_cost, 0)}</td><td className="wrap">The forecast's event coefficient (+{usd(fc.data.coef.event, 0)}/day on known citywide event days) is associative, not causal, and July has no comparable event.</td></tr>
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

function ScenarioTable({ s, cost, costNote }: { s: Scenarios; cost: number; costNote?: string }) {
  return (
    <div className="table-wrap"><table className="dt"><thead><tr><th>Scenario</th><th className="num">Benefit</th><th className="num">Net</th><th className="num">ROI</th></tr></thead>
      <tbody>{(['low', 'base', 'high'] as const).map((k) => (
        <tr key={k}><td><span className="strong">{k[0].toUpperCase() + k.slice(1)}</span><div className="small muted">{s[k].label}</div></td>
          <td className="num">{usd(s[k].benefit, 0)}</td><td className={`num ${s[k].net >= 0 ? 'pos' : 'neg'}`}>{usd(s[k].net, 0)}</td>
          <td className={`num ${(s[k].roi_pct ?? 0) >= 0 ? 'pos' : 'neg'}`}>{s[k].roi_pct === null ? '—' : `${s[k].roi_pct > 0 ? '+' : ''}${s[k].roi_pct}%`}</td></tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={4} className="small muted">Cost {usd(cost, 0)}{costNote ? ` (${costNote})` : ''}</td></tr></tfoot>
    </table></div>
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
