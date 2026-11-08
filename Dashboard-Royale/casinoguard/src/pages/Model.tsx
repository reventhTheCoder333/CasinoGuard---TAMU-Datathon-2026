import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useData } from '../lib/data'
import type { ForecastData } from '../lib/types'
import { dLabel, pctv, usd, usdShort } from '../lib/format'
import { Callout, Kpi, Legend, Loading, PageHead, Panel, Seg } from '../components/ui'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from '../components/chart'

type View = 'holdout' | 'all'
const PRED_KEY: Record<string, string> = { mean: 'pred_mean', weekday: 'pred_weekday', ar: 'pred_ar', regression: 'pred_regression' }
const MODEL_COLOR: Record<string, string> = { mean: '#858479', weekday: SERIES[1], ar: SERIES[6], regression: SERIES[2] }

export default function Model() {
  const { data, error } = useData<ForecastData>('forecast')
  const [view, setView] = useState<View>('holdout')
  const [shown, setShown] = useState<Set<string>>(new Set(['weekday', 'regression']))
  if (!data) return <Loading error={error} />

  const base = data.models.find((m) => m.id === 'weekday')!
  const cand = data.models.find((m) => m.id === 'regression')!
  const ci = cand.gain_ci95
  const conclusive = ci[0] > 0
  const series = (view === 'holdout' ? data.series.filter((s) => s.split === 'holdout') : data.series).map((s) => ({
    ...s,
    err_weekday: s.pred_weekday !== undefined && s.pred_weekday !== null ? s.coin_in_usd - s.pred_weekday : null,
    err_regression: s.pred_regression !== undefined && s.pred_regression !== null ? s.coin_in_usd - s.pred_regression : null,
  }))
  const toggle = (k: string) => setShown((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const coefDow = dow.map((d, i) => ({ d, v: i === 0 ? 0 : data.coef[`dow_${i}`] }))

  return (
    <div>
      <PageHead eyebrow="Decisions · time-series model with time-based holdout" title="Forecasting daily floor coin-in"
        question="Can a simple calendar model forecast daily coin-in better than naive baselines? Trained on Jan–Apr 2025, frozen on April 30, evaluated on May–June 2025." />

      <div className="kpis">
        <Kpi label="Baseline 1 · training mean" value={usd(data.models[0].mae, 0)} sub={`MAE · MAPE ${pctv(data.models[0].mape)}`} tip="Predict the Jan–Apr average daily coin-in for every holdout day." />
        <Kpi label="Baseline 2 · weekday average" value={usd(base.mae, 0)} sub={`MAE · MAPE ${pctv(base.mape)}`} tip="Predict the Jan–Apr average for that weekday." />
        <Kpi label="Candidate · AR(1) on weekday residuals" value={usd(data.models[2].mae, 0)} sub={`MAE · φ = ${data.models[2].phi?.toFixed(3)} · decays to baseline`} tip="Weekday average plus an AR(1) correction from the last training-day residual, forecast recursively without holdout actuals." />
        <Kpi label="Candidate · calendar regression" value={usd(cand.mae, 0)} sub={`MAE · MAPE ${pctv(cand.mape)}`} tone="pos" tip="OLS: weekday dummies + federal holiday + pre-announced event flag + linear trend, fitted on Jan–Apr only." />
      </div>

      <Callout title={conclusive ? 'Result: the calendar regression beats both baselines' : 'Result: modest improvement, not conclusive'} tone={conclusive ? 'gold' : 'warn'}>
        The calendar regression lowers holdout MAE by <b>{usd(cand.mae_gain_vs_weekday, 0)}</b> ({pctv((cand.mae_gain_vs_weekday / base.mae) * 100, 1)}) vs the weekday baseline and is better on {cand.days_better_than_weekday} of {data.n_test} days.
        A 7-day moving-block bootstrap of the per-day error difference gives a 95% interval of <b>{usd(ci[0], 0)} to {usd(ci[1], 0)}</b>{conclusive ? ', excluding zero.' : ' — it includes zero, so we do not claim the model is reliably better.'}
        {' '}Both models agree on the decision-relevant signal: the weekly shape of demand. Both crush the constant-mean baseline ({usd(data.models[0].mae, 0)} MAE).
      </Callout>

      <div className="grid g-21 mt">
        <Panel title="Actual vs predicted daily coin-in" sub={view === 'holdout' ? 'Holdout May 1 – Jun 30 · click legend to toggle models' : 'Training fit (Jan–Apr) and holdout forecasts'}
          actions={<Seg value={view} onChange={setView} label="Range" options={[{ value: 'holdout', label: 'Holdout' }, { value: 'all', label: 'Train + holdout' }]} />}
          source={{ tables: ['1_prepared_views/property_day', '2_machine_decision/calendar_day', '4_context/events'], fields: ['gaming_date', 'coin_in_usd', 'federal_holiday', 'start_date', 'end_date', 'announced_date'], script: 'pipeline/build_data.py (FORECAST section)' }}>
          <Legend items={[{ key: 'actual', label: 'Actual', color: '#eceae4', line: true }, ...data.models.map((m) => ({ key: m.id, label: m.name, color: MODEL_COLOR[m.id], line: true }))]}
            hidden={new Set(data.models.map((m) => m.id).filter((k) => !shown.has(k)))} onToggle={(k) => k !== 'actual' && toggle(k)} />
          <div style={{ height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gaming_date" {...axisProps} tickFormatter={dLabel} minTickGap={36} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 2)} width={60} domain={['auto', 'auto']} />
                {view === 'all' && <ReferenceLine x={data.holdout[0]} stroke={GOLD} strokeDasharray="4 3" label={{ value: 'freeze', fill: GOLD, fontSize: 11, position: 'insideTopRight' }} />}
                <Tooltip content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l, pl) => `${dLabel(String(l))} (${pl?.local_weekday}) · ${pl?.split}`} />} />
                <Line dataKey="coin_in_usd" name="Actual" stroke="#eceae4" strokeWidth={1.6} dot={false} isAnimationActive={false} />
                {view === 'all' && shown.has('weekday') && <Line dataKey="fit_weekday" name="Weekday avg (fit)" stroke={MODEL_COLOR.weekday} strokeWidth={1.5} strokeOpacity={0.5} dot={false} isAnimationActive={false} />}
                {view === 'all' && shown.has('regression') && <Line dataKey="fit_regression" name="Regression (fit)" stroke={MODEL_COLOR.regression} strokeWidth={1.5} strokeOpacity={0.5} dot={false} isAnimationActive={false} />}
                {data.models.filter((m) => shown.has(m.id)).map((m) => (
                  <Line key={m.id} dataKey={PRED_KEY[m.id]} name={m.name} stroke={MODEL_COLOR[m.id]} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Leakage controls" sub="What the forecast was allowed to know on April 30">
          <ul className="list small">
            <li><b>Time split, not random:</b> train {data.train[0]} → {data.train[1]} ({data.n_train} days), holdout {data.holdout[0]} → {data.holdout[1]} ({data.n_test} days).</li>
            <li><b>No holdout actuals as inputs:</b> AR residuals are propagated recursively from the last training day; lagged columns from property_day are not used.</li>
            <li><b>Only pre-announced events:</b> {data.known_events.length} events with announced_date ≤ Apr 30 are used as flags.</li>
            {data.excluded_events.map((e) => <li key={e.event_id}><b>Excluded:</b> {e.name} — announced {e.announced_date}, after the freeze date.</li>)}
            <li><b>No later-published data:</b> LVCVA tourism and survey figures are not inputs.</li>
            <li>Federal holidays come from calendar_day, known in advance.</li>
          </ul>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Holdout comparison" sub="Lower MAE is better · gain = weekday-baseline MAE − model MAE">
          <div className="table-wrap"><table className="dt"><thead><tr><th>Model</th><th className="num">MAE</th><th className="num">MAPE</th><th className="num">Gain vs weekday</th><th className="num">95% CI of gain</th><th className="num">Days better</th></tr></thead>
            <tbody>{data.models.map((m) => (
              <tr key={m.id}><td><span className="row" style={{ gap: 6 }}><span className="tt-key" style={{ width: 12, height: 2, background: MODEL_COLOR[m.id], display: 'inline-block' }} />{m.name} <span className="badge">{m.kind}</span></span></td>
                <td className="num strong">{usd(m.mae, 0)}</td><td className="num">{pctv(m.mape)}</td>
                <td className={`num ${m.mae_gain_vs_weekday > 0 ? 'pos' : m.mae_gain_vs_weekday < 0 ? 'neg' : ''}`}>{m.id === 'weekday' ? '—' : usd(m.mae_gain_vs_weekday, 0)}</td>
                <td className="num">{m.id === 'weekday' ? '—' : `${usd(m.gain_ci95[0], 0)} to ${usd(m.gain_ci95[1], 0)}`}</td>
                <td className="num">{m.id === 'weekday' ? '—' : `${m.days_better_than_weekday} / ${data.n_test}`}</td></tr>
            ))}</tbody></table></div>
        </Panel>
        <Panel title="Forecast error by day" sub="Actual − predicted, holdout · weekday baseline vs regression">
          <Legend items={[{ key: 'w', label: 'Weekday baseline error', color: MODEL_COLOR.weekday, line: true }, { key: 'r', label: 'Regression error', color: MODEL_COLOR.regression, line: true }]} />
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={series.filter((s) => s.split === 'holdout')} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="gaming_date" {...axisProps} tickFormatter={dLabel} minTickGap={36} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 0)} width={52} />
                <ReferenceLine y={0} stroke="#3a4250" />
                <Tooltip content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l) => dLabel(String(l))} />} />
                <Line dataKey="err_weekday" name="Weekday baseline" stroke={MODEL_COLOR.weekday} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                <Line dataKey="err_regression" name="Regression" stroke={MODEL_COLOR.regression} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Weekly shape of demand" sub="Regression weekday effects relative to Monday (coin-in per day)">
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={coefDow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="d" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v) => usdShort(v, 0)} width={52} />
                <ReferenceLine y={0} stroke="#3a4250" />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => usd(v, 0)} labelFmt={(l) => `${l} vs Monday`} />} />
                <Bar dataKey="v" name="Effect vs Monday" fill={SERIES[0]} radius={[4, 4, 4, 4]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="small muted">Other coefficients: known event day {usd(data.coef.event, 0)}, federal holiday {usd(data.coef.holiday, 0)}, trend {usd(data.coef.trend_per_30d, 0)} per 30 days. Associations, not causal effects.</p>
        </Panel>
        <Panel title="Which decision this informs">
          <ul className="list">
            <li><b>When to take machines down.</b> Tuesday and Wednesday have the lowest coin-in (then Monday); Friday–Saturday are highest. The 120-minute machine inspections (Q6, A-INSPECT) and any later machine moves should be scheduled early in the week, in quiet hours.</li>
            <li><b>Measuring July actions.</b> The frozen forecast gives each day's expected coin-in without intervention, so floor-level effects of the Q6 tests are judged against a counterfactual, not against a seasonal June.</li>
            <li><b>What it does not justify.</b> The event coefficient is not evidence that a $15,000 promotion weekend would pay back; we did not fund one.</li>
          </ul>
          <div className="table-wrap mt-s"><table className="dt"><thead><tr><th>Weekday</th><th className="num">Train avg (Jan–Apr)</th><th className="num">Holdout avg (May–Jun)</th></tr></thead>
            <tbody>{data.weekday_profile.map((w) => <tr key={w.weekday}><td>{w.weekday}</td><td className="num">{usd(w.train_avg, 0)}</td><td className="num">{usd(w.holdout_avg, 0)}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>
    </div>
  )
}
