import { useLocation } from 'react-router-dom'
import { useData } from '../lib/data'
import { useFilters } from '../lib/filters'
import { FLOOR_METRICS } from '../lib/metrics'
import { MONTHS, usePeriod } from '../lib/period'
import { mLabel } from '../lib/format'
import type { Q2Data } from '../lib/types'

/** Pages whose data has a zone or theme dimension, so the zone/theme filters change what they show. */
export const ZONE_AWARE = ['/explore', '/q1', '/q2', '/q3']

export function FilterBar() {
  const f = useFilters()
  const p = usePeriod()
  const loc = useLocation()
  const { data } = useData<Q2Data>('q2')
  const zones = data?.zones ?? []
  const themes = [...new Set((data?.theme_month ?? []).map((t) => t.theme))].sort()
  const aware = ZONE_AWARE.includes(loc.pathname)
  const pb = f.playback
  const shown = pb.index ?? (p.m0 === p.m1 ? p.m0 : null)

  return (
    <div className="filterbar" role="region" aria-label="Global filters">
      <div className="fb-group">
        <label className="fb-field">
          <span>Zone</span>
          <select value={f.zone} onChange={(e) => f.setZone(e.target.value)} aria-label="Casino zone">
            <option value="">All zones</option>
            {zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.zone_name}</option>)}
          </select>
        </label>
        <label className="fb-field">
          <span>Theme</span>
          <select value={f.theme} onChange={(e) => f.setTheme(e.target.value)} aria-label="Machine theme">
            <option value="">All themes</option>
            {themes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="fb-field">
          <span>Metric</span>
          <select value={f.metric} onChange={(e) => f.setMetric(e.target.value)} aria-label="Metric">
            {FLOOR_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        {f.active > 0 && <button className="btn sm" onClick={f.clear}>Clear zone &amp; theme</button>}
      </div>

      <div className="fb-group fb-playback" aria-label="Historical playback">
        <button className={`btn sm play-btn ${pb.playing ? 'gold' : ''}`} onClick={pb.playing ? pb.pause : pb.play}
          aria-label={pb.playing ? 'Pause playback' : 'Play months in order'} title={pb.playing ? 'Pause' : 'Play Jan → Jun'}>
          {pb.playing ? '❚❚' : '▶'}
        </button>
        <div className="timeline">
          <input type="range" min={0} max={MONTHS.length - 1} step={1} value={shown ?? 0}
            onChange={(e) => pb.seek(Number(e.target.value))} aria-label="Timeline month" aria-valuetext={shown !== null ? `${mLabel(MONTHS[shown])} 2025` : 'Range'}
            className={shown === null ? 'idle' : ''} />
          <div className="timeline-ticks" aria-hidden="true">
            {MONTHS.map((m, i) => <span key={m} className={i === shown ? 'on' : i >= p.m0 && i <= p.m1 ? 'in' : ''}>{mLabel(m)}</span>)}
          </div>
        </div>
        {pb.index !== null && <button className="btn sm" onClick={pb.exit} title="Return to the period you had selected">Exit playback</button>}
      </div>

      {!aware && f.active > 0 && (
        <span className="fb-note">Zone and theme apply to the Explorer and Q1–Q3; this page's data has no zone or theme.</span>
      )}
    </div>
  )
}
