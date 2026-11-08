import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import type { Q4Data, SegmentRow } from '../lib/types'
import { mLabel, num, pct, pctv, usd, usdShort } from '../lib/format'
import { Callout, Kpi, Legend, Loading, PageHead, Panel, Seg } from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { axisProps, ChartTip, GOLD, gridProps, SERIES, TIER_COLORS } from '../components/chart'

type Dim = 'tier_end' | 'home_region' | 'age_band'
const DIM_LABEL: Record<Dim, string> = { tier_end: 'Loyalty tier (end of period)', home_region: 'Home region', age_band: 'Age band' }

export default function Q4() {
  const p = usePeriod()
  const { data, error } = useData<Q4Data>('q4')
  const [conc, setConc] = useState<'wager' | 'losses'>('losses')
  const [dim, setDim] = useState<Dim>('tier_end')
  const [seg, setSeg] = useState<string | null>(null)

  if (!data) return <Loading error={error} />
  const r = data.ranges[p.key]
  const segs = data.segments[p.key][dim]
  const totalWager = segs.reduce((a, s) => a + s.wager, 0)
  const recon = r.gross_losses - r.winnings_paid
  const lor = (conc === 'wager' ? r.lorenz_wager : r.lorenz_losses).map(([x, y]) => ({ x, y, eq: x }))
  const shares = conc === 'wager' ? r.wager_share : r.loss_share
  const hist = r.net_histogram.map((h) => ({ ...h, side: h.bin.startsWith('-') || h.bin.startsWith('≤') ? 'loss' : h.bin.startsWith('0 (') ? 'even' : 'win' }))
  const monthly = data.monthly.filter((m) => p.months.includes(m.period_month))
  const selSeg = seg ? segs.find((s) => s.segment === seg) : null

  const segCols: Column<SegmentRow>[] = [
    { key: 'segment', label: DIM_LABEL[dim], render: (s) => <span className={s.segment === seg ? 'strong' : ''}>{s.segment}</span> },
    { key: 'players', label: 'Players', num: true, render: (s) => num(s.players) },
    { key: 'wager', label: 'Wagered', num: true, render: (s) => usd(s.wager, 0) },
    { key: 'share', label: 'Share of wagering', num: true, value: (s) => s.wager / totalWager, render: (s) => pct(s.wager / totalWager, 1) },
    { key: 'net', label: 'Casino net', num: true, render: (s) => usd(s.net, 0) },
    { key: 'theo', label: 'Theo win', num: true, render: (s) => usd(s.theo, 0) },
    { key: 'luck', label: 'Actual − theo', num: true, value: (s) => s.net - s.theo, render: (s) => <span className={s.net - s.theo >= 0 ? 'pos' : 'neg'}>{usd(s.net - s.theo, 0)}</span> },
    { key: 'hold', label: 'Hold', num: true, value: (s) => s.net / s.wager, render: (s) => pct(s.net / s.wager) },
    { key: 'per', label: 'Net / player', num: true, value: (s) => s.net / s.players, render: (s) => usd(s.net / s.players) },
    { key: 'losers', label: '% net losers', num: true, value: (s) => s.losers / s.players, render: (s) => pct(s.losers / s.players, 1) },
    { key: 'comp_cost', label: 'Comp cost', num: true, render: (s) => usd(s.comp_cost, 0) },
  ]

  return (
    <div>
      <PageHead eyebrow="Q4 · Player financial intelligence" title="What did tracked players wager, get back and net?"
        question="Loyalty-card (carded) play aggregated per player across the selected months. Casino net = wagered − paid back; positive means players lost." />

      <Callout title="Privacy and scope">
        Only aggregates and rank-based aliases (Player-001…) leave the pipeline — raw player IDs are never exported to the dashboard. Results cover <b>carded play only</b>; uncarded play appears in machine meters (Q1–Q3) but not here.
        Player loss totals are <b>not</b> casino revenue: casino net = gross losses from losing players − winnings paid to winning players.
      </Callout>

      <div className="kpis mt">
        <Kpi label="Tracked players" value={num(r.players)} verified={p.isFull} tip="Distinct player_id with ≥1 player_period row in the selected months." />
        <Kpi label="Total wagering" value={usd(r.wager)} verified={p.isFull} tip="Σ tracked_coin_in_usd." />
        <Kpi label="Total payouts" value={usd(r.payout)} verified={p.isFull} tip="Σ tracked_payout_usd." />
        <Kpi label="Casino net" value={usd(r.casino_net)} verified={p.isFull} sub={`Hold ${pct(r.casino_net / r.wager)}`} tip="Wagering − payouts (player_period). Note: the tracked_net_usd column is from the player's perspective (opposite sign)." />
        <Kpi label="Theoretical win" value={usd(r.theo)} sub={`Actual − theo: ${usd(r.luck, 0)}`} tip="Σ theo_usd = coin-in × (1 − RTP). Actual − theo is aggregate luck." />
        <Kpi label="Wagering Gini" value={r.gini_wager.toFixed(4)} verified={p.isFull} tip="0 = everyone wagers equally, 1 = one player wagers everything. Computed over per-player totals for the period." />
      </div>

      <div className="grid g2 mt">
        <Panel title="Player outcomes" sub={`Per-player net over ${p.label}`} source={{ tables: ['1_prepared_views/player_period'], fields: ['player_id', 'tracked_coin_in_usd', 'tracked_payout_usd'], calc: 'Per player: net = Σ coin-in − Σ payout. Loser if net > $0.005, winner if < −$0.005, else break-even (net within half a cent of zero).' }}>
          <div className="budget-bar" style={{ height: 22 }} role="img" aria-label="Share of players who lost, won, or broke even">
            <div style={{ width: `${(r.losers / r.players) * 100}%`, background: SERIES[1] }} title={`Lost: ${num(r.losers)}`} />
            <div style={{ width: `${(r.winners / r.players) * 100}%`, background: SERIES[2] }} title={`Won: ${num(r.winners)}`} />
            <div style={{ width: `${(r.even / r.players) * 100}%`, background: '#5b6270' }} title={`Even: ${num(r.even)}`} />
          </div>
          <div className="row mt-s small" style={{ gap: 18 }}>
            <span><span className="status-dot" style={{ background: SERIES[1] }} /> <b className="strong">{num(r.losers)}</b> net losses ({pct(r.losers / r.players, 1)})</span>
            <span><span className="status-dot" style={{ background: SERIES[2] }} /> <b className="strong">{num(r.winners)}</b> net winnings ({pct(r.winners / r.players, 1)})</span>
            <span><span className="status-dot" style={{ background: '#5b6270' }} /> <b className="strong">{num(r.even)}</b> break-even</span>
          </div>
          <div className="table-wrap mt">
            <table className="dt"><tbody>
              <tr><td>Gross losses from losing players</td><td className="num strong">{usd(r.gross_losses)}</td></tr>
              <tr><td>− Winnings paid to winning players</td><td className="num strong">{usd(r.winnings_paid)}</td></tr>
              <tr><td><b className="strong">= Casino net</b></td><td className="num strong">{usd(recon)} {Math.abs(recon - r.casino_net) < 0.02 ? <span className="verified">✓ reconciles</span> : <span className="neg">✗ {usd(r.casino_net)}</span>}</td></tr>
            </tbody></table>
          </div>
          {p.isFull && <p className="small muted mt-s">Full period verified: 80,992 losers, 15,504 winners, 17,394 break-even; gross losses $20,939,424.55; winnings $5,353,963.95.</p>}
        </Panel>

        <Panel title="Distribution of player net results" sub="Players by net result from the player's perspective (negative = player lost)" source={{ tables: ['1_prepared_views/player_period'] }}>
          <Legend items={[{ key: 'l', label: 'Player lost', color: SERIES[1] }, { key: 'w', label: 'Player won', color: SERIES[2] }, { key: 'e', label: 'Break-even', color: '#5b6270' }]} />
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={hist} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bin" {...axisProps} interval={0} angle={-40} textAnchor="end" height={60} tick={{ fill: '#858479', fontSize: 10 }} />
                <YAxis {...axisProps} width={46} tickFormatter={(v) => num(v)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => `${num(v)} players`} labelFmt={(l) => `Player net ${l} USD`} />} />
                <Bar dataKey="players" name="Players" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {hist.map((h) => <Cell key={h.bin} fill={h.side === 'loss' ? SERIES[1] : h.side === 'win' ? SERIES[2] : '#5b6270'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Concentration" sub={conc === 'wager' ? 'Share of total wagering held by the top x% of players' : 'Share of gross player losses from the top x% of losing players'}
          actions={<Seg value={conc} onChange={setConc} label="Concentration measure" options={[{ value: 'losses', label: 'Losses' }, { value: 'wager', label: 'Wagering' }]} />}
          source={{ tables: ['1_prepared_views/player_period'], calc: conc === 'wager' ? 'Players ranked by total wagered; top k = ceil(n × x%).' : 'Losing players ranked by casino net; share of Σ gross losses. Top k = ceil(n_losers × x%).', script: 'q4_wager_concentration.py / q4_net_concentration.py → pipeline/build_data.py' }}>
          <div className="table-wrap">
            <table className="dt"><thead><tr><th>Group</th><th className="num">Share</th><th style={{ width: '45%' }} /></tr></thead>
              <tbody>{['1', '5', '10', '20'].map((k) => (
                <tr key={k}><td>Top {k}%</td><td className="num strong">{pctv(shares[k])}</td><td><div className="meter"><span style={{ width: `${shares[k]}%`, background: GOLD }} /></div></td></tr>
              ))}</tbody></table>
          </div>
          <p className="small secondary mt-s">Gini ({conc === 'wager' ? 'wagering, all players' : 'losses, losing players'}): <b className="strong">{(conc === 'wager' ? r.gini_wager : r.gini_losses).toFixed(4)}</b></p>
          {p.isFull && <p className="small muted">Verified: losses top 1/5/10/20% = 15.73 / 40.73 / 52.84 / 66.52%; wagering top 1% = 22.86%, top 5% = 55.34%; Gini 0.7536.</p>}
        </Panel>
        <Panel title="Concentration curve" sub="Cumulative share vs share of players (ranked high → low). Diagonal = perfect equality.">
          <Legend items={[{ key: 'c', label: conc === 'wager' ? 'Wagering' : 'Gross losses', color: GOLD, line: true }, { key: 'e', label: 'Equality', color: '#5b6270', line: true }]} />
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={lor} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid {...gridProps} vertical />
                <XAxis dataKey="x" type="number" domain={[0, 100]} {...axisProps} tickFormatter={(v) => `${v}%`} label={{ value: 'Top x% of players', position: 'insideBottom', offset: -2, fill: '#858479', fontSize: 11 }} />
                <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={44} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(1)}%`} labelFmt={(l) => `Top ${Number(l).toFixed(0)}% of players`} />} />
                <Line dataKey="eq" name="Equality" stroke="#5b6270" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                <Line dataKey="y" name="Cumulative share" stroke={GOLD} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel className="mt" title="Player segments" sub={`${p.label} · click a row to inspect`}
        actions={<Seg value={dim} onChange={(d) => { setDim(d); setSeg(null) }} label="Segment dimension" options={[{ value: 'tier_end', label: 'Tier' }, { value: 'home_region', label: 'Region' }, { value: 'age_band', label: 'Age band' }]} />}
        source={{ tables: ['1_prepared_views/player_period'], fields: ['tier_end', 'home_region', 'age_band', 'tracked_coin_in_usd', 'tracked_payout_usd', 'theo_usd', 'comp_cost_usd'], calc: 'Players are assigned to the segment value on their last month in the selected period; sums are per-player then per-segment (players counted once).' }}>
        <div className="stack">
          <DataTable rows={segs} columns={segCols} rowKey={(s) => s.segment} initialSort={{ key: 'wager', dir: 'desc' }} onRowClick={(s) => setSeg(s.segment === seg ? null : s.segment)} selectedKey={seg} csvName={`q4_segments_${dim}_${p.key}`} />
          <div className="grid g2">
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>Casino net vs theo per player</div>
            <Legend items={[{ key: 'n', label: 'Actual net / player', color: SERIES[0] }, { key: 't', label: 'Theo / player', color: SERIES[3] }]} />
            <div style={{ height: 210 }}>
              <ResponsiveContainer>
                <BarChart data={segs.map((s) => ({ s: s.segment, net: s.net / s.players, theo: s.theo / s.players }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="s" {...axisProps} />
                  <YAxis {...axisProps} width={50} tickFormatter={(v) => usdShort(v, 0)} />
                  <ReferenceLine y={0} stroke="#3a4250" />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => usd(v)} />} />
                  <Bar dataKey="net" name="Actual net / player" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {segs.map((s) => <Cell key={s.segment} fill={dim === 'tier_end' ? TIER_COLORS[s.segment] ?? SERIES[0] : SERIES[0]} fillOpacity={seg && seg !== s.segment ? 0.35 : 1} />)}
                  </Bar>
                  <Bar dataKey="theo" name="Theo / player" fill={SERIES[3]} fillOpacity={0.5} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            {!selSeg && <div className="empty">Select a segment row to see per-player detail.</div>}
            {selSeg && (
              <dl className="kv mt-s">
                <dt>{selSeg.segment}: wager / player</dt><dd>{usd(selSeg.wager / selSeg.players)}</dd>
                <dt>Play hours / player</dt><dd>{num(selSeg.hours / selSeg.players, 2)}</dd>
                <dt>Comp cost / player</dt><dd>{usd(selSeg.comp_cost / selSeg.players)}</dd>
                <dt>Comp cost / theo</dt><dd>{pct(selSeg.comp_cost / selSeg.theo)}</dd>
                <dt>Net winners</dt><dd>{num(selSeg.winners)} ({pct(selSeg.winners / selSeg.players, 1)})</dd>
              </dl>
            )}
          </div>
          </div>
        </div>
      </Panel>

      <div className="grid g2 mt">
        <Panel title="Monthly: actual vs theoretical" sub="Carded play · casino net vs expected (theo) win" source={{ tables: ['1_prepared_views/player_period'], fields: ['tracked_coin_in_usd', 'tracked_payout_usd', 'theo_usd'] }}>
          <Legend items={[{ key: 'a', label: 'Casino net (actual)', color: SERIES[0] }, { key: 't', label: 'Theoretical win', color: SERIES[3] }]} />
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="period_month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={52} tickFormatter={(v) => usdShort(v, 1)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l) => mLabel(String(l))} />} />
                <Bar dataKey="casino_net" name="Casino net" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="theo" name="Theo win" fill={SERIES[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Wagering percentile groups" sub="Full Jan–Jun · players ranked by total wagered" tip="Precomputed for the full period only (percentile membership changes with the period)." source={{ tables: ['1_prepared_views/player_period'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Group</th><th className="num">Players</th><th className="num">Wagered</th><th className="num">Casino net</th><th className="num">Theo</th><th className="num">% losers</th><th className="num">Median net</th></tr></thead>
            <tbody>{data.percentile_groups.map((g) => <tr key={g.group}><td className="strong">{g.group}</td><td className="num">{num(g.players)}</td><td className="num">{usdShort(g.wager, 2)}</td><td className="num">{usdShort(g.casino_net, 2)}</td><td className="num">{usdShort(g.theo, 2)}</td><td className="num">{pct(g.losers / g.players, 1)}</td><td className="num">{usd(g.median_net)}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>

      <Panel className="mt" title="Top 100 players by wagering (anonymised)" sub="Full Jan–Jun · aliases are ranks, not IDs · supports responsible-gaming review, not marketing targeting"
        source={{ tables: ['1_prepared_views/player_period'], note: 'Raw player_id values are not exported. Region and age band are coarse bands from the source data.' }}>
        <DataTable rows={data.top_players} rowKey={(r) => r.alias} searchKeys={['alias', 'tier_end', 'home_region', 'age_band']} initialSort={{ key: 'wager', dir: 'desc' }} pageSize={10} csvName="q4_top100_anonymised"
          columns={[
            { key: 'alias', label: 'Alias', render: (r) => <span className="strong">{r.alias}</span> },
            { key: 'tier_end', label: 'Tier' }, { key: 'home_region', label: 'Region' }, { key: 'age_band', label: 'Age' },
            { key: 'wager', label: 'Wagered', num: true, render: (r) => usd(r.wager, 0) },
            { key: 'casino_net', label: 'Casino net', num: true, render: (r) => usd(r.casino_net, 0) },
            { key: 'theo', label: 'Theo', num: true, render: (r) => usd(r.theo, 0) },
            { key: 'luck', label: 'Actual − theo', num: true, render: (r) => <span className={r.luck >= 0 ? 'pos' : 'neg'}>{usd(r.luck, 0)}</span> },
            { key: 'hours', label: 'Play hours', num: true, render: (r) => num(r.hours, 1) },
            { key: 'sessions', label: 'Sessions', num: true },
          ]} />
      </Panel>
    </div>
  )
}
