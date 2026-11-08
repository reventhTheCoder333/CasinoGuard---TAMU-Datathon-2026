import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { metricDef } from '../lib/metrics'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from './chart'
import { InsightCtxRef } from './ui'

/*
 * Investigation side panel. Any KPI card or chart can open it with a spec built from real data;
 * the panel itself only renders what it is given, plus the metric's formula and source.
 */

export interface InsightSpec {
  title: ReactNode
  eyebrow?: string
  subtitle?: ReactNode
  metricId?: string
  kpis?: { label: string; value: string; sub?: string }[]
  series?: { title: string; points: { label: string; value: number; highlight?: boolean }[]; fmt: (v: number) => string; axis?: (v: number) => string }
  table?: { title: string; columns: string[]; numeric?: boolean[]; rows: ReactNode[][] }
  note?: ReactNode
  actions?: { label: string; to?: string; onClick?: () => void; primary?: boolean }[]
}

interface Ctx { open: (s: InsightSpec) => void; explain: (metricId: string) => void; close: () => void }
const InsightCtx = createContext<Ctx | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useInsight(): Ctx {
  const v = useContext(InsightCtx)
  if (!v) throw new Error('useInsight outside provider')
  return v
}

export function InsightProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<InsightSpec | null>(null)
  const close = useCallback(() => setSpec(null), [])
  const value = useMemo<Ctx>(() => ({
    open: setSpec,
    explain: (metricId) => setSpec({ eyebrow: 'Metric explanation', title: metricDef(metricId).label, metricId }),
    close,
  }), [close])

  useEffect(() => {
    if (!spec) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spec, close])

  return (
    <InsightCtx.Provider value={value}>
      <InsightCtxRef.Provider value={value}>
        {children}
        {spec && <InsightPanel spec={spec} onClose={close} />}
      </InsightCtxRef.Provider>
    </InsightCtx.Provider>
  )
}

export function MetricExplanation({ metricId }: { metricId: string }) {
  const m = metricDef(metricId)
  return (
    <dl className="explain">
      <dt>Formula</dt>
      <dd><code className="formula">{m.formula}</code></dd>
      <dt>How it is calculated</dt>
      <dd>{m.calc}</dd>
      <dt>Source data</dt>
      <dd>{m.tables.map((t) => <code key={t}>{t}</code>)}</dd>
      {m.fields && (<><dt>Fields</dt><dd>{m.fields.map((f) => <code key={f}>{f}</code>)}</dd></>)}
      <dt>Reproduce</dt>
      <dd><code>casinoguard/pipeline/build_data.py</code></dd>
      {m.note && (<><dt>Note</dt><dd>{m.note}</dd></>)}
    </dl>
  )
}

function InsightPanel({ spec, onClose }: { spec: InsightSpec; onClose: () => void }) {
  const nav = useNavigate()
  return (
    <div className="insight-layer" onClick={onClose}>
      <aside className="insight" role="dialog" aria-modal="true" aria-label="Investigation panel" onClick={(e) => e.stopPropagation()}>
        <header className="insight-head">
          <div>
            {spec.eyebrow && <div className="eyebrow">{spec.eyebrow}</div>}
            <h2>{spec.title}</h2>
            {spec.subtitle && <div className="panel-sub">{spec.subtitle}</div>}
          </div>
          <button className="btn sm" onClick={onClose} aria-label="Close panel">✕</button>
        </header>

        <div className="insight-body">
          {spec.kpis && (
            <div className="insight-kpis">
              {spec.kpis.map((k) => (
                <div key={k.label} className="insight-kpi">
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value">{k.value}</div>
                  {k.sub && <div className="kpi-sub">{k.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {spec.series && spec.series.points.length > 0 && (
            <section>
              <h3 className="insight-h">{spec.series.title}</h3>
              <div style={{ height: 180 }}>
                <ResponsiveContainer>
                  <BarChart data={spec.series.points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval={0} tick={{ ...axisProps.tick, fontSize: 10 }} />
                    <YAxis {...axisProps} width={56} tickFormatter={spec.series.axis ?? spec.series.fmt} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => spec.series!.fmt(v)} />} />
                    <Bar dataKey="value" name={spec.metricId ? metricDef(spec.metricId).label : 'Value'} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {spec.series.points.map((p) => <Cell key={p.label} fill={p.highlight ? GOLD : SERIES[0]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {spec.table && spec.table.rows.length > 0 && (
            <section>
              <h3 className="insight-h">{spec.table.title}</h3>
              <div className="table-wrap">
                <table className="dt">
                  <thead><tr>{spec.table.columns.map((c, i) => <th key={c} className={spec.table!.numeric?.[i] ? 'num' : ''}>{c}</th>)}</tr></thead>
                  <tbody>{spec.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={spec.table!.numeric?.[j] ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </section>
          )}

          {spec.note && <p className="small secondary">{spec.note}</p>}

          {spec.metricId && (
            <section>
              <h3 className="insight-h">How {metricDef(spec.metricId).label.toLowerCase()} is calculated</h3>
              <MetricExplanation metricId={spec.metricId} />
            </section>
          )}
        </div>

        {spec.actions && spec.actions.length > 0 && (
          <footer className="insight-foot">
            {spec.actions.map((a) => (
              <button key={a.label} className={`btn ${a.primary ? 'gold' : ''}`}
                onClick={() => { a.onClick?.(); if (a.to) { nav(a.to) } onClose() }}>
                {a.label}
              </button>
            ))}
          </footer>
        )}
      </aside>
    </div>
  )
}
