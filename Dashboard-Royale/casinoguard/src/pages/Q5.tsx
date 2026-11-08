import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod, MONTHS } from '../lib/period'
import type { Q5Data } from '../lib/types'
import { dLabel, mLabel, num, pct, pctv, sum, usd, usdShort } from '../lib/format'
import { Callout, Kpi, Legend, Loading, PageHead, Panel, Seg } from '../components/ui'
import { axisProps, ChartTip, GOLD, gridProps, SERIES, TIER_COLORS } from '../components/chart'

export default function Q5() {
  const p = usePeriod()
  const { data, error } = useData<Q5Data>('q5')
  const [base, setBase] = useState<'tracked' | 'property'>('tracked')
  const [benefitMonths, setBenefitMonths] = useState<[string, string]>(['2025-04', '2025-05'])

  const ledgerMonthly = useMemo(() => {
    if (!data) return []
    return MONTHS.map((mo) => {
      const d = data.ledger_daily.filter((x) => x.gaming_date.startsWith(mo))
      const face = sum(d, (x) => x.face)
      const pts = -sum(d, (x) => x.points)
      return { month: mo, redemptions: sum(d, (x) => x.redemptions), redeemed: pts, awarded: sum(d, (x) => x.award_points), awards: sum(d, (x) => x.awards), face, cost: sum(d, (x) => x.cost), ppd: pts / face }
    })
  }, [data])

  if (!data) return <Loading error={error} />
  const months = p.months
  const mm = data.monthly.filter((m) => months.includes(m.month))
  const cost = sum(mm, (m) => m.comp_cost), face = sum(mm, (m) => m.face), red = sum(mm, (m) => m.redemptions)
  const lm = ledgerMonthly.filter((m) => months.includes(m.month))
  const daily = data.ledger_daily.filter((d) => p.inRange(d.gaming_date))
  const tierMonths = months.map((mo) => {
    const row: Record<string, string | number> = { month: mo }
    ;['Base', 'Gold', 'Platinum'].forEach((t) => { const x = data.points_per_dollar_by_tier.find((r) => r.month === mo && r.tier_before === t); if (x) row[t] = x.points_per_face_dollar })
    return row
  })
  const trans = months.map((mo) => {
    const row: Record<string, string | number> = { month: mo }
    data.tier_transitions.filter((t) => t.month === mo).forEach((t) => { row[t.path] = t.n })
    return row
  })
  const paths = Object.keys(data.tier_paths)
  const benefits = [...new Set(data.benefits.map((b) => b.benefit_id))]
  const bRow = (b: string, mo: string) => data.benefits.find((x) => x.benefit_id === b && x.month === mo)
  const pre = ledgerMonthly.slice(0, 4), post = ledgerMonthly.slice(4, 6)
  const avgPre = sum(pre, (m) => m.redeemed) / 4, avgPost = sum(post, (m) => m.redeemed) / 2
  const redPre = sum(pre, (m) => m.redemptions) / 4, redPost = sum(post, (m) => m.redemptions) / 2
  const includesChange = months.includes('2025-05') || months.includes('2025-06')

  return (
    <div>
      <PageHead eyebrow="Q5 · Loyalty intelligence" title="What did the comp program cost, and did anything change?"
        question="Comps are free food and drink redeemed with loyalty points. Face value is the menu price; economic cost is what the casino actually spends (cost of goods)." />

      <div className="kpis">
        <Kpi label="Actual economic comp cost" value={usd(cost)} verified={p.isFull} tip="Σ player_period.comp_cost_usd — reconciles to property_day and loyalty_ledger (see below)." />
        <Kpi label="Total face value" value={usd(face)} verified={p.isFull} sub={`Cost is ${pct(cost / face, 1)} of face`} tip="Σ comp_face_value_usd. Menu value, not cash spent." />
        <Kpi label="Redemptions" value={num(red)} verified={p.isFull} tip="Σ comps_redeemed (= ledger redeem events)." />
        <Kpi label="Avg cumulative cost / unique player" value={p.isFull ? usd(data.summary.avg_cost_per_player) : '—'} verified={p.isFull ? true : undefined} sub={p.isFull ? `${num(data.summary.unique_players)} players` : 'full period only'} tip="Comp cost ÷ distinct tracked players in Jan–Jun." />
        <Kpi label="Loyalty award events" value={num(p.isFull ? data.summary.award_events : sum(lm, (m) => m.awards))} verified={p.isFull} sub={p.isFull ? 'all ledger award rows' : 'by gaming date'} tip="Ledger rows with event_type = award, assigned to gaming date (6am–6am)." />
        <Kpi label="Tier transitions" value={num(sum(data.tier_transitions.filter((t) => months.includes(t.month)), (t) => t.n))} sub={p.isFull ? `Base→Gold ${num(data.tier_paths['Base → Gold'])} · Gold→Platinum ${num(data.tier_paths['Gold → Platinum'])}` : undefined} tip="Ledger rows where tier_before ≠ tier_after." />
      </div>

      <Callout title="What changed on May 1: points charged per comp dollar fell by about half — in every tier" tone="gold">
        Jan–Apr, redemptions consumed an average of <b>{num(avgPre)}</b> points/month; May–Jun only <b>{num(avgPost)}</b> ({pctv((avgPost / avgPre - 1) * 100, 1)}), while redemption counts did not fall ({num(redPre)} → {num(redPost)}/month) and each item's face value and cost were unchanged.
        Within each tier the rate dropped from roughly 15.0 → 7.0 (Base), 12.0 → 5.6 (Gold) and 9.0 → 4.2 (Platinum) points per face dollar, so a shift in tier mix does not explain it.
        This pattern is <b>consistent with</b> a change in redemption pricing, but the data contains no policy record — we report it as an observed change, not a confirmed policy decision. Over the same months, comp cost / tracked theo rose from 1.11% (Jan) to 1.32% (Jun).
      </Callout>

      <div className="grid g2 mt">
        <Panel title="Monthly comp cost" sub={`Economic cost · ${p.label}`} source={{ tables: ['1_prepared_views/player_period'], fields: ['period_month', 'comp_cost_usd'] }}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={mm} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={50} tickFormatter={(v) => usdShort(v, 0)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => usd(v)} labelFmt={(l) => `${mLabel(String(l))} 2025`} extra={(pl) => <div className="small muted">{num(Number(pl.redemptions))} redemptions · {num(Number(pl.redeeming_players))} redeeming players</div>} />} />
                <Bar dataKey="comp_cost" name="Comp cost" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Comp cost as % of theoretical gaming revenue" sub={base === 'tracked' ? 'Denominator: carded theo (player_period.theo_usd)' : 'Denominator: whole-floor theo (property_day.theo_usd)'}
          actions={<Seg value={base} onChange={setBase} label="Denominator" options={[{ value: 'tracked', label: 'Carded theo' }, { value: 'property', label: 'Floor theo' }]} />}
          source={{ tables: ['1_prepared_views/player_period', '1_prepared_views/property_day'], calc: 'Monthly Σ comp_cost_usd ÷ Σ theo_usd. Carded theo is the natural base since only carded players earn comps.' }}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={mm} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={46} tickFormatter={(v) => `${v.toFixed(2)}%`} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip fmt={(v) => pctv(v)} labelFmt={(l) => `${mLabel(String(l))} 2025`} />} />
                <Line dataKey={base === 'tracked' ? 'cost_pct_tracked_theo' : 'cost_pct_property_theo'} name="Cost / theo" stroke={GOLD} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Points charged per comp face dollar" sub={`Daily, all tiers · ${p.label}${includesChange ? ' · dashed line = May 1' : ''}`}
          source={{ tables: ['3_guests/loyalty_ledger', '2_machine_decision/calendar_day'], fields: ['event_type', 'points_delta', 'face_value_cents', 'event_at_utc'], calc: 'Per gaming day: −Σ points_delta ÷ (Σ face_value_cents ÷ 100) over redeem events. Ledger timestamps mapped to 6am–6am gaming days.' }}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gaming_date" {...axisProps} tickFormatter={dLabel} minTickGap={40} />
                <YAxis {...axisProps} width={36} domain={[0, 'auto']} />
                {includesChange && p.inRange('2025-05-01') && <ReferenceLine x="2025-05-01" stroke={GOLD} strokeDasharray="4 3" />}
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(2)} pts / $`} labelFmt={(l) => dLabel(String(l))} extra={(pl) => <div className="small muted">{num(Number(pl.redemptions))} redemptions · {usd(Number(pl.face), 0)} face</div>} />} />
                <Line dataKey="points_per_face_dollar" name="Points per face $" stroke={SERIES[0]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Same measure by tier" sub="Monthly · rules out a change in tier mix" source={{ tables: ['3_guests/loyalty_ledger'], fields: ['tier_before', 'points_delta', 'face_value_cents'] }}>
          <Legend items={['Base', 'Gold', 'Platinum'].map((t) => ({ key: t, label: t, color: TIER_COLORS[t], line: true }))} />
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={tierMonths} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={36} domain={[0, 'auto']} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(2)} pts / $`} labelFmt={(l) => mLabel(String(l))} />} />
                {['Base', 'Gold', 'Platinum'].map((t) => <Line key={t} dataKey={t} name={t} stroke={TIER_COLORS[t]} strokeWidth={2} dot={{ r: 3.5 }} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Points movement" sub="Ledger, by gaming month" tip="Awarded points dwarf redeemed points; they are shown in a table rather than on one shared axis." source={{ tables: ['3_guests/loyalty_ledger'], fields: ['event_type', 'points_delta'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Month</th><th className="num">Award events</th><th className="num">Points awarded</th><th className="num">Redemptions</th><th className="num">Points redeemed</th><th className="num">Pts / face $</th></tr></thead>
            <tbody>{lm.map((m) => <tr key={m.month}><td>{mLabel(m.month)}</td><td className="num">{num(m.awards)}</td><td className="num">{num(m.awarded)}</td><td className="num">{num(m.redemptions)}</td><td className="num strong">{num(m.redeemed)}</td><td className="num">{m.ppd.toFixed(2)}</td></tr>)}</tbody></table></div>
          <p className="small muted mt-s">July 2025 is excluded: by UTC month the ledger shows 1,920 award and 162 redeem events in "July", but all except one belong to the June 30 gaming day (6am–6am local). The remaining row is a partial day and is not treated as a month.</p>
        </Panel>
        <Panel title="Face value vs economic cost" sub="Monthly · economic cost is the real spend" source={{ tables: ['1_prepared_views/player_period'], fields: ['comp_face_value_usd', 'comp_cost_usd'] }}>
          <Legend items={[{ key: 'f', label: 'Face value', color: SERIES[3] }, { key: 'c', label: 'Economic cost', color: SERIES[0] }]} />
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={mm} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={50} tickFormatter={(v) => usdShort(v, 0)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => usd(v)} labelFmt={(l) => mLabel(String(l))} />} />
                <Bar dataKey="face" name="Face value" fill={SERIES[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="comp_cost" name="Economic cost" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Redemption pricing by benefit" sub="Average points charged per item — face and cost per item do not change"
          actions={<>
            <select aria-label="Compare month A" value={benefitMonths[0]} onChange={(e) => setBenefitMonths([e.target.value, benefitMonths[1]])}>{MONTHS.map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}</select>
            <span className="muted small">vs</span>
            <select aria-label="Compare month B" value={benefitMonths[1]} onChange={(e) => setBenefitMonths([benefitMonths[0], e.target.value])}>{MONTHS.map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}</select>
          </>}
          source={{ tables: ['3_guests/loyalty_ledger'], fields: ['benefit_id', 'points_delta', 'face_value_cents', 'economic_cost_cents'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Benefit</th><th className="num">Face</th><th className="num">Cost</th><th className="num">Avg pts {mLabel(benefitMonths[0])}</th><th className="num">Avg pts {mLabel(benefitMonths[1])}</th><th className="num">Change</th></tr></thead>
            <tbody>{benefits.map((b) => {
              const a = bRow(b, benefitMonths[0]), c = bRow(b, benefitMonths[1])
              return <tr key={b}><td>{b.replace('COMP-', '').toLowerCase()}</td><td className="num">{usd(a?.face ?? c?.face)}</td><td className="num">{usd(a?.cost ?? c?.cost)}</td><td className="num">{num(a?.avg_points, 1)}</td><td className="num">{num(c?.avg_points, 1)}</td>
                <td className="num">{a && c ? <span className={c.avg_points < a.avg_points * 0.97 ? 'neg' : 'muted'}>{pctv((c.avg_points / a.avg_points - 1) * 100, 1)}</span> : '—'}</td></tr>
            })}</tbody></table></div>
        </Panel>
        <Panel title="Tier transitions" sub={`Upgrades by month · ${p.label}`} source={{ tables: ['3_guests/loyalty_ledger'], fields: ['tier_before', 'tier_after'] }}>
          <Legend items={paths.map((pa, i) => ({ key: pa, label: `${pa} (${num(data.tier_paths[pa])} total)`, color: i === 0 ? TIER_COLORS.Gold : TIER_COLORS.Platinum }))} />
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={trans} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={44} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => num(v)} labelFmt={(l) => mLabel(String(l))} />} />
                {paths.map((pa, i) => <Bar key={pa} dataKey={pa} name={pa} stackId="t" fill={i === 0 ? TIER_COLORS.Gold : TIER_COLORS.Platinum} radius={i === paths.length - 1 ? [4, 4, 0, 0] : undefined} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Reconciliation across three sources" sub="Full Jan–Jun · all three must agree" tip="If the three independent tables disagreed, a comp cost could be double-counted or missing. They agree to the cent."
          source={{ tables: ['1_prepared_views/player_period', '1_prepared_views/property_day', '3_guests/loyalty_ledger'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Source</th><th>Fields</th><th className="num">Economic cost</th><th className="num">Face value</th><th className="num">Redemptions</th><th /></tr></thead>
            <tbody>{data.reconciliation.map((r) => {
              const ok = Math.abs(r.economic_cost - 190669.3) < 0.01 && Math.abs(r.face_value - 682749.5) < 0.01
              return <tr key={r.source}><td className="strong">{r.source}</td><td className="small">{r.fields}</td><td className="num">{usd(r.economic_cost)}</td><td className="num">{usd(r.face_value)}</td><td className="num">{r.redemptions === null ? <span className="muted">n/a</span> : num(r.redemptions)}</td><td>{ok ? <span className="verified">✓</span> : <span className="neg">✗</span>}</td></tr>
            })}</tbody></table></div>
          <p className="small muted mt-s">Comp cost is already inside F&amp;B cost of goods (cost_rules CR-FNB-COGS); it is counted once here.</p>
        </Panel>
        <Panel title="Comp cost by tier" sub="Full Jan–Jun · tier at end of each player-month" source={{ tables: ['1_prepared_views/player_period'], fields: ['tier_end', 'comp_cost_usd', 'theo_usd'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Tier</th><th className="num">Players</th><th className="num">Comp cost</th><th className="num">Redemptions</th><th className="num">Cost / theo</th></tr></thead>
            <tbody>{data.tier_cost.map((t) => <tr key={t.tier_end}><td><span className="status-dot" style={{ background: TIER_COLORS[t.tier_end] }} /> {t.tier_end}</td><td className="num">{num(t.players)}</td><td className="num">{usd(t.comp_cost)}</td><td className="num">{num(t.redemptions)}</td><td className="num">{pct(t.comp_cost / t.theo)}</td></tr>)}</tbody></table></div>
          <p className="small muted mt-s">Players can appear in more than one tier row if they upgraded during the half-year.</p>
        </Panel>
      </div>
    </div>
  )
}
