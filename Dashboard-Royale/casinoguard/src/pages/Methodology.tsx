import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import type { Meta } from '../lib/types'
import { num } from '../lib/format'
import { Loading, PageHead, Panel, SourceBox, type Source } from '../components/ui'
import { DataTable } from '../components/DataTable'

interface Method { q: string; title: string; to: string; question: string; data: string[]; columns: string[]; transforms: ReactNode; formulas: ReactNode; technique: string; result: ReactNode; limits: ReactNode }

const METHODS: Method[] = [
  {
    q: 'Q1', title: 'Machine performance', to: '/q1', question: 'Which machines are truly underperforming once exposure, availability and luck are accounted for?',
    data: ['1_prepared_views/prepared_daily_view', '2_machine_decision/machines', '2_machine_decision/game_math', '2_machine_decision/calendar_day'],
    columns: ['machine_id', 'gaming_date', 'active', 'config_id', 'zone_id', 'available_hours', 'occupied_hours', 'theo_usd', 'house_win_usd', 'luck_residual_usd', 'scheduled_seconds'],
    transforms: <>Aggregate machine × day to machine (and machine × month for period filtering). Dominant location = most active days. Inactive (pre-install / post-retire) days carry 0 available hours.</>,
    formulas: <>occupancy = Σ occupied ÷ Σ available · theo/hr = Σ theo ÷ Σ available · score = 0.6 (1 − pct_rank<sub>config</sub>(theo/hr)) + 0.4 (1 − pct_rank<sub>config</sub>(occupancy)) · eligible: ≥ 90 on-floor days and available &gt; 0.</>,
    technique: 'Peer-group percentile scoring (within identical game configuration); luck checked via actual − theo; location checked via zone-relative occupancy.',
    result: <>Top 10: M-1014, M-1008, M-1045, M-1040, M-1230, M-1048, M-1265, M-1221, M-1227, M-1082 — all in Back Forty.</>,
    limits: <>Percentiles compare within configuration but not within zone, so location is entangled with the score. Weights (60/40) are a judgement call. Preliminary candidates only.</>,
  },
  {
    q: 'Q2', title: 'Floor demand', to: '/q2', question: 'What changed in demand across the floor over six months, and why?',
    data: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly', '4_context/events', '4_context/real_sources/city_visitation_monthly', '5_optional/machine_hour'],
    columns: ['zone_id', 'bank_id', 'theme', 'coin_in_usd', 'occupied_hours', 'available_hours', 'entries_count', 'coverage_minutes', 'counter_status'],
    transforms: <>Zone × month and bank × month sums over active machine-days; traffic hours mapped to gaming days via calendar_day UTC bounds; offline counter hours dropped.</>,
    formulas: <>daily coin-in = Σ coin-in ÷ gaming days · entries/hr = Σ entries ÷ Σ coverage hours · change = month_b ÷ month_a − 1 · r = Pearson(daily entries/hr, daily coin-in).</>,
    technique: 'Period-over-period comparison with exposure normalisation; correlation of traffic and demand; event overlay.',
    result: <>Jan→Jun daily coin-in fell most in High-Limit Room (−11.2%) and Back Forty (−10.1%, traffic −10.3%, r = 0.979); Center Pit rose +10.5%.</>,
    limits: <>Traffic counts entries, not unique visitors, and miss seated players. Correlation is inflated by shared weekly cycles. LVCVA data describes the city, not this casino.</>,
  },
  {
    q: 'Q3', title: 'Maintenance', to: '/q3', question: 'How much play was lost to downtime, and when?',
    data: ['2_machine_decision/operations', '1_prepared_views/prepared_daily_view', '2_machine_decision/floor_locations', '2_machine_decision/calendar_day'],
    columns: ['operation_id', 'machine_id', 'event_type', 'opened_at_utc', 'work_started_at_utc', 'available_at_utc', 'direct_cost_cents', 'location_id'],
    transforms: <>Durations from UTC timestamps (DST-safe). Tickets assigned to the gaming date of opened_at. Machine theo rate from reported meter days.</>,
    formulas: <>downtime = available_at − opened_at · response = work_started_at − opened_at · estimated exposure = fault downtime × (Σ theo ÷ Σ available hours).</>,
    technique: 'Event-duration analysis with exposure valuation; manufacturer normalisation by fleet size.',
    result: <>1,226 tickets (1,207 fault repairs), 5,021.08 h downtime, 4.10 h avg, 1.12 h avg response. Highest exposure M-1002 $1,557.63; highest downtime M-1065 81.11 h.</>,
    limits: <>Exposure assumes average play and no substitution to other machines → upper-bound estimate, not actual lost revenue. Fault timing may correlate with busy periods.</>,
  },
  {
    q: 'Q4', title: 'Player financials', to: '/q4', question: 'What did tracked players wager, get back and net, and how concentrated are those results?',
    data: ['1_prepared_views/player_period'],
    columns: ['player_id', 'period_month', 'tracked_coin_in_usd', 'tracked_payout_usd', 'tracked_net_usd', 'theo_usd', 'tier_end', 'home_region', 'age_band'],
    transforms: <>Player × month summed to player for each of the 21 contiguous month ranges. Segment = attribute on the player's last month in range.</>,
    formulas: <>casino net = Σ coin-in − Σ payout (= −Σ tracked_net_usd, which is player-perspective) · top-x% share with k = ceil(n × x) · Gini = 2Σ i·x<sub>(i)</sub> ÷ (nΣx) − (n+1)/n.</>,
    technique: 'Distributional analysis: outcome split, concentration curves, Gini, segment comparison against theo.',
    result: <>$163.80M wagered, $148.22M paid, $15.59M casino net; 80,992 losers / 15,504 winners / 17,394 even; top 5% of losers = 40.73% of gross losses; wagering Gini 0.7536.</>,
    limits: <>Carded play only. Within-period netting means a player's month-to-month swings cancel. No guest is identified; results must not be used to target heavy losers.</>,
  },
  {
    q: 'Q5', title: 'Loyalty / comps', to: '/q5', question: 'What did the comp program cost, and did anything about it change?',
    data: ['1_prepared_views/player_period', '1_prepared_views/property_day', '3_guests/loyalty_ledger', '2_machine_decision/cost_rules'],
    columns: ['comp_cost_usd', 'comp_face_value_usd', 'comps_redeemed', 'event_type', 'points_delta', 'benefit_id', 'tier_before', 'tier_after', 'face_value_cents', 'economic_cost_cents'],
    transforms: <>Ledger events mapped to gaming dates; three independent sources reconciled; points per face dollar computed per day, per tier, per benefit.</>,
    formulas: <>cost % theo = Σ comp cost ÷ Σ carded theo · points per $ = −Σ points_delta ÷ (Σ face_value_cents ÷ 100) over redeems.</>,
    technique: 'Three-way reconciliation; structural-break inspection with tier stratification to rule out mix effects.',
    result: <>$190,669.30 economic cost / $682,749.50 face across all three sources; points per comp $ halved on May 1 in every tier; cost/theo 1.11% → 1.32%.</>,
    limits: <>No policy documentation in the data — the May change is observed, not attributed. July rows by UTC month are almost all June 30 gaming-day events; the remainder is partial and excluded.</>,
  },
  {
    q: 'ML', title: 'Forecast model', to: '/model', question: 'Can a calendar model forecast daily coin-in better than simple baselines?',
    data: ['1_prepared_views/property_day', '2_machine_decision/calendar_day', '4_context/events'],
    columns: ['gaming_date', 'coin_in_usd', 'federal_holiday', 'start_date', 'end_date', 'announced_date'],
    transforms: <>Train Jan 1–Apr 30; holdout May 1–Jun 30; event flags only for events announced on/before Apr 30.</>,
    formulas: <>MAE = mean |actual − predicted| · OLS: coin-in ~ weekday + holiday + event + trend · 7-day moving-block bootstrap for the MAE gain interval.</>,
    technique: 'Time-based holdout, two baselines (training mean, weekday average), two candidates (AR(1) residual, calendar regression).',
    result: <>Regression MAE $65,187 vs weekday $68,699; gain CI includes zero — modest, not conclusive.</>,
    limits: <>Only four months of training; one structural pattern (weekday) dominates. Event effect is associative.</>,
  },
]

interface Claim { claim: string; evidence: string; result: string; alt: string; limit: string; to: string; source: Source }
const CLAIMS: Claim[] = [
  { claim: 'The ten preliminary underperformers are all in Back Forty.', evidence: 'prepared_daily_view → finalize_bottom_10 scoring (src/lib/q1.ts)', result: '10/10 in Z-B40; list reproduced exactly', alt: 'The machines themselves are weak titles', limit: 'Score compares within config, not zone', to: '/q1', source: { tables: ['1_prepared_views/prepared_daily_view'], fields: ['config_id', 'zone_id', 'theo_usd', 'available_hours', 'occupied_hours'] } },
  { claim: 'Low earnings of the candidates are not explained by bad luck.', evidence: 'Σ luck_residual_usd per machine', result: '9 of 10 earned ≥ theo over Jan–Jun', alt: 'High-volatility variance', limit: 'Six months is short for high-volatility games', to: '/q1', source: { tables: ['1_prepared_views/prepared_daily_view'], fields: ['luck_residual_usd', 'house_win_usd', 'theo_usd'] } },
  { claim: 'Back Forty demand fell with its foot traffic.', evidence: 'zone_month + zone_traffic_hourly', result: 'Coin-in/day −10.1%, entries/hr −10.3% Jan→Jun; daily r = 0.979', alt: 'Seasonality or citywide visitor decline', limit: 'Entries ≠ visitors; correlation shares weekly cycle', to: '/q2', source: { tables: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly'], fields: ['coin_in_usd', 'entries_count', 'coverage_minutes'] } },
  { claim: 'Ridgeline machines are the main source of downtime.', evidence: 'operations ⋈ machines, fault repairs per machine', result: '7.23 repairs/machine vs 3.02 and 1.93', alt: 'Ridgeline machines are older or busier', limit: 'Age and usage not controlled', to: '/q3', source: { tables: ['2_machine_decision/operations', '2_machine_decision/machines'], fields: ['event_type', 'manufacturer', 'opened_at_utc', 'available_at_utc'] } },
  { claim: 'Fault downtime exposed ≈ $88k of theo over six months.', evidence: 'downtime × machine theo/available hr', result: '$88,346.72 (estimate)', alt: 'Players switch to other machines', limit: 'Upper bound; not actual lost revenue', to: '/q3', source: { tables: ['2_machine_decision/operations', '1_prepared_views/prepared_daily_view'], fields: ['downtime', 'theo_usd', 'available_hours'] } },
  { claim: 'An extra technician cannot pay back in 30 days.', evidence: 'response share of fault downtime', result: '27.9% → ≤ $4,089 exposure / 30 days < $11,520', alt: 'Faster response shortens repair too', limit: 'Ignores staff-coverage side benefits', to: '/recommendations', source: { tables: ['2_machine_decision/operations', '2_machine_decision/action_catalog'], fields: ['work_started_at_utc', 'unit_cost_cents'] } },
  { claim: 'Tracked casino net was $15,585,460.60.', evidence: 'Σ coin-in − Σ payout, player_period', result: 'Matches; reconciles to gross losses − winnings', alt: '—', limit: 'Carded play only', to: '/q4', source: { tables: ['1_prepared_views/player_period'], fields: ['tracked_coin_in_usd', 'tracked_payout_usd'] } },
  { claim: 'Losses are highly concentrated.', evidence: 'ranked per-player casino net', result: 'Top 5% of losers = 40.73% of gross losses', alt: 'A few lucky/unlucky sessions', limit: 'Within-period netting', to: '/q4', source: { tables: ['1_prepared_views/player_period'], fields: ['player_id', 'tracked_coin_in_usd', 'tracked_payout_usd'] } },
  { claim: 'Comp cost reconciles across three sources.', evidence: 'player_period vs property_day vs loyalty_ledger', result: '$190,669.30 / $682,749.50 in all three', alt: '—', limit: 'Comp cost already inside F&B COGS', to: '/q5', source: { tables: ['1_prepared_views/player_period', '1_prepared_views/property_day', '3_guests/loyalty_ledger'], fields: ['comp_cost_usd', 'economic_cost_cents'] } },
  { claim: 'Points charged per comp dollar halved on May 1.', evidence: 'ledger redeems by gaming day, tier, benefit', result: 'Base 15.0→7.0, Gold 12.0→5.6, Platinum 9.0→4.2', alt: 'Tier mix shift (ruled out: every tier halved)', limit: 'No policy record; cause not attributed', to: '/q5', source: { tables: ['3_guests/loyalty_ledger'], fields: ['points_delta', 'face_value_cents', 'tier_before', 'benefit_id'] } },
  { claim: 'A calendar model forecasts coin-in slightly better than a weekday average.', evidence: 'Jan–Apr train, May–Jun holdout', result: 'MAE $65,187 vs $68,699; CI includes 0', alt: 'Holdout noise', limit: 'Not statistically conclusive', to: '/model', source: { tables: ['1_prepared_views/property_day', '4_context/events'], fields: ['coin_in_usd', 'announced_date'] } },
]

export default function Methodology() {
  const meta = useData<Meta>('meta')
  const [claim, setClaim] = useState<number | null>(null)
  if (!meta.data) return <Loading error={meta.error} />
  const cov = meta.data.coverage

  return (
    <div>
      <PageHead eyebrow="Methodology & evidence" title="How each finding was produced"
        question="Every number in CASINOGUARD is generated by casinoguard/pipeline/build_data.py from the original Dashboard Royale tables. Re-run it to reproduce the dashboard end to end." />

      {METHODS.map((m) => (
        <details className="acc" key={m.q} open={m.q === 'Q1'}>
          <summary><span className="badge gold">{m.q}</span> {m.title} <span className="muted small" style={{ fontWeight: 400 }}>— {m.question}</span></summary>
          <div className="acc-body">
            <dl className="method-grid">
              <dt>Question</dt><dd>{m.question}</dd>
              <dt>Datasets</dt><dd>{m.data.map((d) => <code key={d} style={{ marginRight: 6 }}>{d}</code>)}</dd>
              <dt>Columns</dt><dd>{m.columns.map((d) => <code key={d} style={{ marginRight: 6 }}>{d}</code>)}</dd>
              <dt>Transformations</dt><dd>{m.transforms}</dd>
              <dt>Formulas</dt><dd>{m.formulas}</dd>
              <dt>Technique</dt><dd>{m.technique}</dd>
              <dt>Main result</dt><dd className="strong">{m.result}</dd>
              <dt>Limitations</dt><dd>{m.limits}</dd>
            </dl>
            <Link to={m.to} className="btn sm mt-s">Open {m.title} →</Link>
          </div>
        </details>
      ))}

      <Panel className="mt" title="Claims & Evidence" sub="Click a row to inspect the source dataset and fields behind the claim">
        <DataTable rows={CLAIMS.map((c, i) => ({ ...c, i }))} rowKey={(c) => String(c.i)} pageSize={12} csvName="claims_and_evidence" onRowClick={(c) => setClaim(c.i === claim ? null : c.i)} selectedKey={claim === null ? null : String(claim)}
          columns={[
            { key: 'claim', label: 'Claim', wrap: true, render: (c) => <span className="strong">{c.claim}</span> },
            { key: 'evidence', label: 'Supporting dataset / query', wrap: true },
            { key: 'result', label: 'Result', wrap: true },
            { key: 'alt', label: 'Alternative explanation', wrap: true },
            { key: 'limit', label: 'Limitation', wrap: true },
          ]} />
        {claim !== null && (
          <div className="mt-s">
            <SourceBox source={CLAIMS[claim].source} />
            <Link to={CLAIMS[claim].to} className="btn sm">Go to the finding →</Link>
          </div>
        )}
      </Panel>

      <div className="grid g2 mt">
        <Panel title="Verification checks" sub={`${meta.data.checks_passed} of ${meta.data.checks_total} pass · generated ${meta.data.generated_at}`} tip="Each check re-computes a verified team result from the raw data and compares it with the expected value. The pipeline exits with an error if any check fails.">
          <DataTable rows={meta.data.checks} rowKey={(c) => c.name} pageSize={10} searchKeys={['name', 'source']} csvName="verification_checks"
            columns={[
              { key: 'ok', label: '', sortable: false, render: (c) => c.ok ? <span className="verified">✓</span> : <span className="neg">✗</span> },
              { key: 'name', label: 'Check', wrap: true },
              { key: 'computed', label: 'Computed', num: true, render: (c) => num(c.computed, Math.abs(c.computed) < 10 ? 4 : 2) },
              { key: 'expected', label: 'Expected', num: true, render: (c) => num(c.expected, Math.abs(c.expected) < 10 ? 4 : 2) },
            ]} />
        </Panel>
        <div className="stack">
          <Panel title="Data provenance">
            <dl className="kv">
              <dt>Data release</dt><dd>{meta.data.data_release}</dd>
              <dt>Analysis window</dt><dd>{String(cov.date_start)} → {String(cov.date_end)} ({cov.gaming_days} gaming days)</dd>
              <dt>Machine-days (active)</dt><dd>{num(Number(cov.machine_days))} ({num(Number(cov.active_machine_days))})</dd>
              <dt>Tracked players / player-months</dt><dd>{num(Number(cov.tracked_players))} / {num(Number(cov.player_months))}</dd>
              <dt>Operations tickets</dt><dd>{num(Number(cov.operations_tickets))}</dd>
              <dt>Traffic counter-hours (ok / partial / offline)</dt><dd>{num(Number(cov.counter_hours_ok))} / {num(Number(cov.counter_hours_partial))} / {num(Number(cov.counter_hours_offline))}</dd>
            </dl>
            <p className="small muted mt-s">Conventions: gaming day = 6am–6am local; durations from UTC timestamps; ratios are ratio-of-sums; cents converted once to dollars; days before install / after retirement excluded; offline traffic hours excluded (never zero-filled).</p>
          </Panel>
          <Panel title="Team analysis scripts reused">
            <ul className="list small">
              <li><code>analysis/q1_machine_performance/finalize_bottom_10.py</code> → Q1 scoring (ported to <code>src/lib/q1.ts</code>)</li>
              <li><code>analysis/q2_floor_demand/</code>: <code>q2_demand_analysis.py</code>, <code>q2_traffic_analysis.py</code>, <code>q2_time_analysis.py</code> → Q2 (outputs cross-checked)</li>
              <li><code>analysis/q3_maintenance/</code>: <code>analyze_maintenance.py</code>, <code>analyze_q3_timing.py</code> → Q3 exposure method</li>
              <li><code>analysis/q4_player_financials/q4_*.py</code> → Q4 aggregation, concentration, Gini</li>
              <li><code>analysis/q5_loyalty/q5_analysis.py</code> → Q5 costs, ledger and tier transitions</li>
            </ul>
          </Panel>
          <Panel title="AI-use disclosure">
            <p className="small secondary">An AI coding assistant (Claude) was used to build the dashboard application and the consolidated data pipeline, port the team's Python analyses, and draft explanatory text. All figures are computed by the pipeline from the provided data and checked against the team's verified results; recommendations and assumptions were reviewed by the team.</p>
          </Panel>
        </div>
      </div>
      <p className="small muted mt">The casino and its people are fictional; all data is synthetic except the public files in data/4_context/real_sources. No finding describes a real casino.</p>
    </div>
  )
}
