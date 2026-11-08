import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import type { ClaimRow, Meta } from '../lib/types'
import { num } from '../lib/format'
import { Loading, PageHead, Panel, SourceBox } from '../components/ui'
import { DataTable } from '../components/DataTable'

interface Method { q: string; title: string; to: string; question: string; data: string[]; columns: string[]; transforms: ReactNode; formulas: ReactNode; technique: string; limits: ReactNode }

const METHODS: Method[] = [
  {
    q: 'Q1', title: 'Machine performance', to: '/q1', question: 'Which machines are truly underperforming once exposure, availability and luck are accounted for?',
    data: ['1_prepared_views/prepared_daily_view', '2_machine_decision/machines', '2_machine_decision/game_math', '2_machine_decision/calendar_day'],
    columns: ['machine_id', 'gaming_date', 'active', 'config_id', 'zone_id', 'available_hours', 'occupied_hours', 'theo_usd', 'house_win_usd', 'paid_spins', 'payout_multiplier_variance', 'bet_options_cents', 'scheduled_seconds'],
    transforms: <>Aggregate machine × day to machine (and machine × month for period filtering). Dominant location = most active days. Inactive (pre-install / post-retire) days carry 0 available hours.</>,
    formulas: <>occupancy = Σ occupied ÷ Σ available · theo/hr = Σ theo ÷ Σ available · score = 0.6 (1 − pct_rank<sub>config</sub>(theo/hr)) + 0.4 (1 − pct_rank<sub>config</sub>(occupancy)) · eligible: ≥ 90 on-floor days and available &gt; 0.</>,
    technique: 'Peer-group percentile scoring within identical game configuration; location tested by re-ranking every machine within its own zone; luck and payout anomalies tested with a variance-scaled z-score per machine (game_math payout variance × bet-mix factor ÷ spins), flagged at the Bonferroni-corrected 5% level.',
    limits: <>Weights (60/40) and the 20% zone cut-off are judgement calls. Bet size per spin is not recorded, so an equal mix of listed bets is assumed (conservative). A flagged payout gap is a reason to inspect, not proof of a fault.</>,
  },
  {
    q: 'Q2', title: 'Floor demand', to: '/q2', question: 'What changed in demand across the floor over six months, and why?',
    data: ['1_prepared_views/prepared_daily_view', '4_context/zone_traffic_hourly', '2_machine_decision/floor_walkways', '4_context/events', '4_context/real_sources/city_visitation_monthly', '5_optional/machine_hour'],
    columns: ['zone_id', 'bank_id', 'theme', 'coin_in_usd', 'occupied_hours', 'available_hours', 'entries_count', 'coverage_minutes', 'counter_status'],
    transforms: <>Zone × month and bank × month sums over active machine-days; traffic hours mapped to gaming days via calendar_day UTC bounds; offline counter hours dropped.</>,
    formulas: <>daily coin-in = Σ coin-in ÷ gaming days · entries/hr = Σ entries ÷ Σ coverage hours · change = month_b ÷ month_a − 1 · r = Pearson(daily entries/hr, daily coin-in).</>,
    technique: 'Period-over-period comparison with exposure normalisation; walkway-closure event study with equal whole-week before / during / after windows and a difference-in-differences against the rest of the floor; traffic–demand correlation; event overlay.',
    limits: <>Traffic counts entries, not unique visitors, and miss seated players. Correlation is inflated by shared weekly cycles. LVCVA data describes the city, not this casino.</>,
  },
  {
    q: 'Q3', title: 'Maintenance', to: '/q3', question: 'How much play was lost to downtime, and when?',
    data: ['2_machine_decision/operations', '1_prepared_views/prepared_daily_view', '2_machine_decision/floor_locations', '2_machine_decision/calendar_day'],
    columns: ['operation_id', 'machine_id', 'event_type', 'opened_at_utc', 'work_started_at_utc', 'available_at_utc', 'direct_cost_cents', 'location_id'],
    transforms: <>Durations from UTC timestamps (DST-safe). Tickets assigned to the gaming date of opened_at. Machine theo rate from reported meter days.</>,
    formulas: <>downtime = available_at − opened_at · response = work_started_at − opened_at · estimated exposure = fault downtime × (Σ theo ÷ Σ available hours).</>,
    technique: 'Event-duration analysis with exposure valuation; manufacturer normalisation by fleet size.',
    limits: <>Exposure assumes average play and no substitution to other machines → upper-bound estimate, not actual lost revenue. Fault timing may correlate with busy periods.</>,
  },
  {
    q: 'Q4', title: 'Player financials', to: '/q4', question: 'What did tracked players wager, get back and net, and how concentrated are those results?',
    data: ['1_prepared_views/player_period'],
    columns: ['player_id', 'period_month', 'tracked_coin_in_usd', 'tracked_payout_usd', 'tracked_net_usd', 'theo_usd', 'tier_end', 'home_region', 'age_band'],
    transforms: <>Player × month summed to player for each of the 21 contiguous month ranges. Segment = attribute on the player's last month in range.</>,
    formulas: <>casino net = Σ coin-in − Σ payout (= −Σ tracked_net_usd, which is player-perspective) · top-x% share with k = ceil(n × x) · Gini = 2Σ i·x<sub>(i)</sub> ÷ (nΣx) − (n+1)/n.</>,
    technique: 'Distributional analysis: outcome split, concentration curves, Gini, segment comparison against theo.',
    limits: <>Carded play only. Within-period netting means a player's month-to-month swings cancel. No guest is identified; results must not be used to target heavy losers.</>,
  },
  {
    q: 'Q5', title: 'Loyalty / comps', to: '/q5', question: 'What did the comp program cost, and did anything about it change?',
    data: ['1_prepared_views/player_period', '1_prepared_views/property_day', '3_guests/loyalty_ledger', '2_machine_decision/cost_rules'],
    columns: ['comp_cost_usd', 'comp_face_value_usd', 'comps_redeemed', 'event_type', 'points_delta', 'benefit_id', 'tier_before', 'tier_after', 'face_value_cents', 'economic_cost_cents'],
    transforms: <>Ledger events mapped to gaming dates; three independent sources reconciled; points per face dollar computed per day, per tier, per benefit.</>,
    formulas: <>cost % theo = Σ comp cost ÷ Σ carded theo · points per $ = −Σ points_delta ÷ (Σ face_value_cents ÷ 100) over redeems.</>,
    technique: 'Three-way reconciliation; structural-break inspection with tier stratification to rule out mix effects.',
    limits: <>No policy documentation in the data — the May change is observed, not attributed. July rows by UTC month are almost all June 30 gaming-day events; the remainder is partial and excluded.</>,
  },
  {
    q: 'Q6', title: '$100,000 budget', to: '/q6', question: 'Which actions would we fund with $100,000, and how would we know they worked?',
    data: ['2_machine_decision/action_catalog', '2_machine_decision/cost_rules', 'Q1 payout test', 'Q2 closure analysis', 'Q5 comp cost'],
    columns: ['unit_cost_cents', 'recurring_cost_cents_per_day', 'lead_days', 'downtime_minutes', 'quantity_limit', 'incompatibility_group'],
    transforms: <>Inspection targets = the five lowest payout z-scores among machines on the floor on June 30. Signage zone = the far side of the closed walkway with the largest gap after reopening. Pilot sized from the May–Jun vs Jan–Apr comp cost change.</>,
    formulas: <>cost = qty × (unit + daily × max(0, 30 − lead)) · benefit = effect × operating days · net = benefit − cost · break-even = cost ÷ high-scenario benefit.</>,
    technique: 'Priced scenario analysis (low = no effect, base and high from measured effect sizes) with break-even points; budget rules asserted in the pipeline and re-checked on the page.',
    limits: <>Benefits are theo (expected win) or comp cost, not profit, and only for days inside the 30-day horizon. Effect sizes of signage and comp pricing are not in the data; the low scenario assumes none.</>,
  },
  {
    q: 'ML', title: 'Forecast model', to: '/model', question: 'Can a calendar model forecast daily coin-in better than simple baselines?',
    data: ['1_prepared_views/property_day', '2_machine_decision/calendar_day', '4_context/events'],
    columns: ['gaming_date', 'coin_in_usd', 'federal_holiday', 'start_date', 'end_date', 'announced_date'],
    transforms: <>Train Jan 1–Apr 30; holdout May 1–Jun 30; event flags only for events announced on/before Apr 30.</>,
    formulas: <>MAE = mean |actual − predicted| · OLS: coin-in ~ weekday + holiday + event + trend · 7-day moving-block bootstrap for the MAE gain interval.</>,
    technique: 'Time-based holdout, two baselines (training mean, weekday average), two candidates (AR(1) residual, calendar regression). The frozen model forecasts July to schedule downtime and to set each Q6 measurement design (floor-level detection limit).',
    limits: <>Only four months of training; one structural pattern (weekday) dominates. Event effect is associative.</>,
  },
]

const CLAIM_FIELDS: [keyof ClaimRow, string][] = [
  ['q', 'Question'], ['claim', 'Claim'], ['result', 'Result'], ['calculation', 'Calculation'], ['query', 'Source query'],
  ['tables', 'Tables'], ['fields', 'Fields'], ['alt', 'Alternative explanation'], ['test', 'How it was tested'], ['limit', 'Limitation'],
]

function cell(v: ClaimRow[keyof ClaimRow]) {
  return Array.isArray(v) ? v.join('; ') : String(v)
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function claimsCsv(rows: ClaimRow[]) {
  const esc = (x: string) => `"${x.replace(/"/g, '""')}"`
  return [CLAIM_FIELDS.map(([, l]) => esc(l)).join(','), ...rows.map((r) => CLAIM_FIELDS.map(([k]) => esc(cell(r[k]))).join(','))].join('\n')
}

function claimsMarkdown(rows: ClaimRow[], generated: string, disclosure: string) {
  const parts = [`# Claims & Evidence appendix — Dashboard Royale`, '', `Generated ${generated} by casinoguard/pipeline/build_data.py from the challenge data (release 0.9.0-draft). The casino and its data are fictional.`, '']
  rows.forEach((r, i) => {
    parts.push(`## ${i + 1}. [${r.q}] ${r.claim}`, '')
    CLAIM_FIELDS.filter(([k]) => k !== 'q' && k !== 'claim').forEach(([k, l]) => parts.push(`- **${l}:** ${cell(r[k])}`))
    parts.push('')
  })
  parts.push('## AI-use disclosure', '', disclosure, '')
  return parts.join('\n')
}

const AI_DISCLOSURE = 'AI tools were used extensively and disclosed here. An AI coding assistant (Anthropic Claude, via Claude Code) wrote most of the dashboard application and the consolidated data pipeline, ported the team\'s Python analyses to the pipeline and to TypeScript, and wrote the automated tests. It also proposed and implemented analyses: the luck / payout z-test, the zone-adjusted ranking, the walkway-closure event study, the July forecast decisions, and the revised Q6 plan with its scenario and break-even calculations; it drafted most explanatory text, this appendix and the claims wording. Every figure is computed by the pipeline from the challenge data and checked by automated tests and verification checks; the team is responsible for reviewing the analyses, assumptions and recommendations before submission. The in-dashboard assistant runs a local model (Ollama, qwen2.5:3b) on the user\'s own machine only; it answers from a knowledge base generated from the same pipeline output and is not part of the public deployment. CASINOGUARD (the separate AML demo in this repository) was also built with the AI assistant and uses its own synthetic data, not the challenge data.'

export default function Methodology() {
  const meta = useData<Meta>('meta')
  const claimsData = useData<{ generated_at: string; claims: ClaimRow[] }>('claims')
  const [claim, setClaim] = useState<number | null>(null)
  if (!meta.data || !claimsData.data) return <Loading error={meta.error || claimsData.error} />
  const CLAIMS = claimsData.data.claims
  const claimsFor = (q: string) => CLAIMS.filter((c) => c.q === q)
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
              <dt>Main results</dt><dd>{claimsFor(m.q).length ? <ul className="list">{claimsFor(m.q).map((c) => <li key={c.claim}><b>{c.claim}</b> {c.result}</li>)}</ul> : <span className="muted">See the page.</span>}</dd>
              <dt>Limitations</dt><dd>{m.limits}</dd>
            </dl>
            <Link to={m.to} className="btn sm mt-s">Open {m.title} →</Link>
          </div>
        </details>
      ))}

      <Panel className="mt" title="Claims & Evidence" sub={`${CLAIMS.length} claims generated by the pipeline from the data · click a row to inspect its sources`}
        actions={<>
          <button className="btn sm" onClick={() => download('claims_and_evidence.csv', claimsCsv(CLAIMS), 'text/csv')}>Download CSV</button>
          <button className="btn sm gold" onClick={() => download('claims_and_evidence.md', claimsMarkdown(CLAIMS, claimsData.data!.generated_at, AI_DISCLOSURE), 'text/markdown')}>Download appendix (Markdown)</button>
        </>}>
        <DataTable rows={CLAIMS.map((c, i) => ({ ...c, i }))} rowKey={(c) => String(c.i)} pageSize={12} csvName="claims_and_evidence" onRowClick={(c) => setClaim(c.i === claim ? null : c.i)} selectedKey={claim === null ? null : String(claim)}
          columns={[
            { key: 'claim', label: 'Claim', wrap: true, render: (c) => <span className="strong">{c.claim}</span> },
            { key: 'q', label: 'Q' },
            { key: 'result', label: 'Result', wrap: true },
            { key: 'query', label: 'Source query', wrap: true, render: (c) => <code>{c.query}</code> },
            { key: 'alt', label: 'Alternative explanation', wrap: true, render: (c) => <>{c.alt}<div className="small muted">Tested: {c.test}</div></> },
            { key: 'limit', label: 'Limitation', wrap: true },
          ]} />
        {claim !== null && (
          <div className="mt-s">
            <SourceBox source={{ tables: CLAIMS[claim].tables, fields: CLAIMS[claim].fields, calc: CLAIMS[claim].calculation, note: CLAIMS[claim].limit }} />
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
            <p className="small secondary">{AI_DISCLOSURE}</p>
            <p className="small muted">The same text is included in the downloadable appendix.</p>
          </Panel>
        </div>
      </div>
      <p className="small muted mt">The casino and its people are fictional; all data is synthetic except the public files in data/4_context/real_sources. No finding describes a real casino.</p>
    </div>
  )
}
