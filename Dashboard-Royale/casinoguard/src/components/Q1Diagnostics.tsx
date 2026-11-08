import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PayoutDiag, Q1Data } from '../lib/types'
import { mLabel, num, pct, usd } from '../lib/format'
import { Callout, Panel } from './ui'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from './chart'

/**
 * Q1 · luck, location or leak? Everything here comes from q1.json `diagnostics`, computed in
 * pipeline/build_data.py from prepared_daily_view and game_math (full Jan–Jun period).
 */
export function Q1Diagnostics({ data, zoneName, onSelect }: { data: Q1Data; zoneName: (z: string) => string; onSelect: (id: string) => void }) {
  const d = data.diagnostics
  const machineSpecific = d.candidates.filter((c) => c.verdict.startsWith('machine'))
  const location = d.candidates.filter((c) => c.verdict.startsWith('location'))
  const zs = d.candidates.map((c) => c.z)
  const flagged = d.machines.filter((m) => m.payout_verdict === 'payout anomaly lead').sort((a, b) => a.z - b.z)
  const lowest = [...d.machines].sort((a, b) => a.z - b.z).slice(0, 8)
  const lead: PayoutDiag = flagged[0] ?? lowest[0]
  const monthly = data.machine_month.filter((r) => r.machine_id === lead.machine_id && r.spins > 0)
    .map((r) => ({ month: r.month, obs: (r.house_win / r.coin_in) * 100, exp: (r.theo / r.coin_in) * 100, faults: r.faults }))
  const leadFaults = monthly.reduce((a, r) => a + r.faults, 0)

  return (
    <>
      <Callout title="Answer: luck, location or leak?" tone="gold">
        <b>Location:</b> {location.length} of the 10 config-ranked candidates are ordinary <i>for their own zone</i> ({location.map((c) => c.machine_id).join(', ')}); they look weak only because of where they stand.
        {' '}<b>Machine:</b> {machineSpecific.length} stay in the weakest {pct(d.location_pct, 0)} even when compared only with their zone ({machineSpecific.map((c) => c.machine_id).join(', ')}) — these are the genuinely underperforming candidates.
        {' '}<b>Luck:</b> none of the ten has an unusual payout gap (z from {Math.min(...zs).toFixed(2)} to {Math.max(...zs).toFixed(2)}).
        {' '}<b>Leak:</b> {flagged.length ? <>{flagged.length} machine{flagged.length > 1 ? 's' : ''} ({flagged.map((m) => m.machine_id).join(', ')}) paid out significantly more than {flagged.length > 1 ? 'their settings allow' : 'its setting allows'} — a lead to inspect, not proof of a fault.</> : 'no machine passes the corrected threshold.'}
      </Callout>

      <div className="grid g2 mt">
        <Panel title="Location check: candidates ranked within their own zone" sub="Rank 1 = weakest in its zone · click a row for the machine detail"
          tip={<>Theo per available hour is first divided by the floor-wide median for the machine's configuration, then machines are ranked only against their own zone. Score = 0.6 × (1 − theo/hr percentile) + 0.4 × (1 − occupancy percentile), the same weights as the main ranking.</>}
          source={{ tables: ['1_prepared_views/prepared_daily_view'], fields: ['zone_id', 'config_id', 'theo_usd', 'available_hours', 'occupied_hours'], calc: <>Machine-specific when in the weakest {pct(d.location_pct, 0)} of its zone (rank ÷ zone size).</>, script: 'pipeline/analytics.py · zone_adjusted_scores' }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Machine</th><th>Zone</th><th className="num">Rank in zone</th><th className="num">Payout z</th><th>Verdict</th></tr></thead>
            <tbody>{d.candidates.map((c) => (
              <tr key={c.machine_id} className="clickable" onClick={() => onSelect(c.machine_id)}>
                <td className="strong">{c.machine_id}</td><td>{zoneName(c.zone_id)}</td>
                <td className="num">{c.zone_rank} / {c.zone_count}</td><td className="num">{c.z.toFixed(2)}</td>
                <td>{c.verdict.startsWith('machine') ? <span className="badge crit">Machine</span> : <span className="badge">Location</span>}</td>
              </tr>
            ))}</tbody></table></div>
        </Panel>

        <Panel title="Leak check: payout versus configuration" sub={`Lowest of ${d.tests} machines · flagged when z ≤ −${d.z_flag.toFixed(2)} (5% level, corrected for ${d.tests} tests)`}
          tip={<>z = (observed hold − expected hold) ÷ standard error, where the standard error comes from the game's published payout variance and the machine's spin count. A negative z means the machine paid out more than its setting predicts.</>}
          source={{ tables: ['1_prepared_views/prepared_daily_view', '2_machine_decision/game_math'], fields: ['house_win_usd', 'theo_usd', 'paid_spins', 'payout_multiplier_variance', 'bet_options_cents'], calc: d.method, note: 'Bet size per spin is not recorded; an equal mix of the listed bet sizes is assumed, which widens the standard error (a more conservative test than equal bets).', script: 'pipeline/analytics.py · hold_z' }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Machine</th><th>Zone</th><th className="num">Expected hold</th><th className="num">Observed</th><th className="num">z</th><th className="num">Months below theo</th><th>Verdict</th></tr></thead>
            <tbody>{lowest.map((m) => (
              <tr key={m.machine_id} className="clickable" onClick={() => onSelect(m.machine_id)}>
                <td className="strong">{m.machine_id}</td><td>{zoneName(m.zone_id)}</td>
                <td className="num">{pct(m.exp_hold)}</td><td className="num">{pct(m.obs_hold)}</td>
                <td className={`num ${m.z <= -d.z_flag ? 'neg' : ''}`}>{m.z.toFixed(2)}</td>
                <td className="num">{m.months_below} / {m.months_obs}</td>
                <td>{m.payout_verdict === 'payout anomaly lead' ? <span className="badge crit">Inspect</span> : m.payout_verdict.startsWith('watch') ? <span className="badge warn">Watch</span> : <span className="badge">Luck</span>}</td>
              </tr>
            ))}</tbody></table></div>
        </Panel>
      </div>

      <Panel className="mt detail" title={`Investigation: ${lead.machine_id} · ${lead.theme} · ${zoneName(lead.zone_id)}`}
        sub={`Monthly observed hold vs the ${pct(lead.exp_hold, 1)} its configuration (${lead.config_id}, ${lead.volatility} volatility) predicts`}
        actions={<button className="btn sm" onClick={() => onSelect(lead.machine_id)}>Open machine detail</button>}
        source={{ tables: ['1_prepared_views/prepared_daily_view', '2_machine_decision/game_math'], fields: ['house_win_usd', 'coin_in_usd', 'theo_usd', 'faults_opened'] }}>
        <div className="grid g-21">
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <ComposedChart data={monthly} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} tickFormatter={(v) => `${v}%`} width={44} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(2)}%`} labelFmt={(l) => `${mLabel(String(l))} 2025`} />} />
                <Bar dataKey="obs" name="Observed hold" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {monthly.map((r) => <Cell key={r.month} fill={r.obs < r.exp ? SERIES[1] : SERIES[0]} />)}
                </Bar>
                <Line dataKey="exp" name="Expected hold (configuration)" stroke={GOLD} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <dl className="kv">
            <dt>Observed vs expected hold</dt><dd>{pct(lead.obs_hold)} vs {pct(lead.exp_hold)}</dd>
            <dt>Gap ÷ standard error</dt><dd className={lead.z <= -d.z_flag ? 'neg' : ''}>z = {lead.z.toFixed(2)}</dd>
            <dt>Months below theo</dt><dd>{lead.months_below} of {lead.months_obs} (chance if fair ≈ {pct(lead.binom_p, 1)})</dd>
            <dt>Shortfall vs theo, Jan–Jun</dt><dd>{usd(lead.shortfall, 0)} ({usd(lead.shortfall_per_active_day, 0)} per day on the floor)</dd>
            <dt>Paid spins</dt><dd>{num(lead.spins)}</dd>
            <dt>Faults opened</dt><dd>{leadFaults}</dd>
            <dt>Q1 rank in its zone</dt><dd>{lead.zone_rank ? `${lead.zone_rank} / ${lead.zone_count}` : 'not eligible'}</dd>
          </dl>
        </div>
        <p className="small secondary mt-s">
          The shortfall is beyond what the game's payout variance explains even after correcting for testing all {d.tests} machines, and it appears in {lead.months_below} of {lead.months_obs} months rather than in one lucky streak.
          Possible explanations to check: a paytable or configuration that differs from <code>game_math</code>, a meter fault, or chance. This is a reason to inspect (Q6), not evidence of wrongdoing.
        </p>
      </Panel>
    </>
  )
}
