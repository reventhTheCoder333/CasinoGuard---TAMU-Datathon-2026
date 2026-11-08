import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/** Set by InsightProvider so primitives can open explanations without a hard dependency. */
// eslint-disable-next-line react-refresh/only-export-components
export const InsightCtxRef = createContext<{ explain: (metricId: string) => void } | null>(null)

/* ---------------- Info tooltip ---------------- */
export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="info-btn"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        i
      </button>
      {open && <span role="tooltip" id={id} className="info-pop">{children}</span>}
    </span>
  )
}

/* ---------------- Provenance ---------------- */
export interface Source {
  tables: string[]
  fields?: string[]
  calc?: ReactNode
  script?: string
  note?: ReactNode
}
export function SourceBox({ source }: { source: Source }) {
  return (
    <dl className="source-box">
      <dt>Source dataset{source.tables.length > 1 ? 's' : ''}</dt>
      <dd>{source.tables.map((t) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}</dd>
      {source.fields && (<><dt>Fields</dt><dd>{source.fields.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}</dd></>)}
      {source.calc && (<><dt>Calculation</dt><dd>{source.calc}</dd></>)}
      <dt>Reproduce</dt>
      <dd><code>{source.script ?? 'casinoguard/pipeline/build_data.py'}</code></dd>
      {source.note && (<><dt>Note</dt><dd>{source.note}</dd></>)}
    </dl>
  )
}

/* ---------------- Panel ---------------- */
export function Panel({
  title, sub, actions, source, children, className = '', tip,
}: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; source?: Source; children: ReactNode; className?: string; tip?: ReactNode }) {
  const [showSrc, setShowSrc] = useState(false)
  return (
    <section className={`panel ${className}`}>
      {(title || actions || source) && (
        <div className="panel-head">
          <div className="titles">
            {title && <h2 className="row" style={{ gap: 6 }}>{title}{tip && <InfoTip>{tip}</InfoTip>}</h2>}
            {sub && <div className="panel-sub">{sub}</div>}
          </div>
          <div className="panel-actions">
            {actions}
            {source && (
              <button className={`btn sm ${showSrc ? 'gold' : ''}`} onClick={() => setShowSrc((s) => !s)} aria-expanded={showSrc}>
                ⓘ Source
              </button>
            )}
          </div>
        </div>
      )}
      {showSrc && source && <SourceBox source={source} />}
      {children}
    </section>
  )
}

/* ---------------- KPI ---------------- */
export function Kpi({
  label, value, sub, tip, verified, to, tone, metric, onOpen, active,
}: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tip?: ReactNode; verified?: boolean; to?: string; tone?: 'pos' | 'neg'
  /** Metric registry id: adds a formula button that opens its explanation. */
  metric?: string
  /** Opens an investigation panel; takes precedence over `to`. */
  onOpen?: () => void
  active?: boolean
}) {
  const nav = useNavigate()
  const insight = useContext(InsightCtxRef)
  const go = onOpen ?? (to ? () => nav(to) : undefined)
  return (
    <div
      className={`kpi ${go ? 'link' : ''} ${active ? 'active' : ''}`}
      onClick={go}
      role={go ? 'button' : undefined}
      tabIndex={go ? 0 : undefined}
      onKeyDown={go ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) go() } : undefined}
    >
      <div className="kpi-label">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
        {metric && insight && (
          <button type="button" className="formula-btn" aria-label="How this is calculated" title="Formula and source"
            onClick={(e) => { e.stopPropagation(); insight.explain(metric) }}>ƒ</button>
        )}
      </div>
      <div className={`kpi-value ${tone ?? ''}`}>{value}</div>
      <div className="kpi-sub">
        {sub}
        {verified !== undefined && (
          <div>{verified ? <span className="verified">✓ matches verified result</span> : <span className="muted">recomputed for selected period</span>}</div>
        )}
      </div>
    </div>
  )
}

/* ---------------- Segmented control ---------------- */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, onChange, options, label, allLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; allLabel?: string }) {
  return (
    <label className="ctrl">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Callout({ title, children, tone = 'blue' }: { title?: ReactNode; children: ReactNode; tone?: 'blue' | 'gold' | 'warn' }) {
  return (
    <div className={`callout ${tone === 'blue' ? '' : tone}`}>
      {title && <div className="callout-title">{title}</div>}
      {children}
    </div>
  )
}

export function PageHead({ eyebrow, title, question, right }: { eyebrow: string; title: string; question?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head row" style={{ alignItems: 'flex-end' }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {question && <div className="question">{question}</div>}
      </div>
      {right}
    </div>
  )
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="loading">{error ? <span className="neg">Could not load data: {error}</span> : 'Loading data…'}</div>
}

export function Legend({ items, onToggle, hidden }: { items: { key: string; label: string; color: string; line?: boolean }[]; onToggle?: (k: string) => void; hidden?: Set<string> }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span
          key={it.key}
          className={`lg ${onToggle ? 'click' : ''} ${hidden?.has(it.key) ? 'off' : ''}`}
          onClick={onToggle ? () => onToggle(it.key) : undefined}
          role={onToggle ? 'button' : undefined}
          tabIndex={onToggle ? 0 : undefined}
          onKeyDown={onToggle ? (e) => { if (e.key === 'Enter') onToggle(it.key) } : undefined}
        >
          <span className={it.line ? 'ln' : 'sw'} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function Meter({ value, color }: { value: number; color?: string }) {
  return <div className="meter"><span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /></div>
}
