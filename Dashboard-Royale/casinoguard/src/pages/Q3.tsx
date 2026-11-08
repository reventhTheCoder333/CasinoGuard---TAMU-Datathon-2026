import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useData } from '../lib/data'
import { usePeriod } from '../lib/period'
import { useFilters } from '../lib/filters'
import type { Q2Data, Q3Data, Ticket, Q1Data } from '../lib/types'
import { hours, mLabel, num, pct, sum, usd } from '../lib/format'
import { Callout, Kpi, Loading, PageHead, Panel, Seg, Select } from '../components/ui'
import { DataTable, type Column } from '../components/DataTable'
import { axisProps, ChartTip, GOLD, gridProps, SERIES } from '../components/chart'

interface MachineAgg { machine_id: string; manufacturer: string; zone_id: string; tickets: number; faults: number; downtime: number; avg_downtime: number; avg_response: number; cost: number; theo_per_hour: number; exposure: number }

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TYPE_LABEL: Record<string, string> = { fault_repair: 'Fault repair', install: 'Install', move: 'Move', scheduled_maintenance: 'Scheduled maintenance', retire: 'Retire' }

export default function Q3() {
  const p = usePeriod()
  const { data, error } = useData<Q3Data>('q3')
  const q2 = useData<Q2Data>('q2')
  const [type, setType] = useState('')
  const [mfr, setMfr] = useState('')
  // Zone and theme are the global filters; a ticket's theme is its machine's theme (q1.json machines).
  const { zone, setZone, theme, setTheme } = useFilters()
  const q1 = useData<Q1Data>('q1')
  const themeOf = useMemo(() => new Map((q1.data?.machines ?? []).map((m) => [m.machine_id, m.theme])), [q1.data])
  const [machine, setMachine] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [hourMetric, setHourMetric] = useState<'downtime' | 'count' | 'exposure'>('downtime')

  const tickets = useMemo(() => (data?.tickets ?? []).filter((t) =>
    p.inRange(t.gaming_date) && (!type || t.event_type === type) && (!mfr || t.manufacturer === mfr) && (!zone || t.zone_id === zone) && (!theme || themeOf.get(t.machine_id) === theme) &&
    (!machine || t.machine_id.toLowerCase().includes(machine.toLowerCase().trim())),
  ), [data, p, type, mfr, zone, theme, themeOf, machine])

  const machines = useMemo<MachineAgg[]>(() => {
    const m = new Map<string, Ticket[]>()
    tickets.forEach((t) => { const a = m.get(t.machine_id); if (a) a.push(t); else m.set(t.machine_id, [t]) })
    return [...m.entries()].map(([id, ts]) => ({
      machine_id: id, manufacturer: ts[0].manufacturer, zone_id: ts[ts.length - 1].zone_id, tickets: ts.length,
      faults: ts.filter((t) => t.event_type === 'fault_repair').length,
      downtime: sum(ts, (t) => t.downtime_hours), avg_downtime: sum(ts, (t) => t.downtime_hours) / ts.length,
      avg_response: sum(ts, (t) => t.response_hours) / ts.length, cost: sum(ts, (t) => t.direct_cost),
      theo_per_hour: ts[0].theo_per_hour, exposure: sum(ts, (t) => t.est_exposure),
    }))
  }, [tickets])

  if (!data || !q2.data || (theme && !q1.data)) return <Loading error={error || q2.error || q1.error} />
  const zn = Object.fromEntries(q2.data.zones.map((z) => [z.zone_id, z.zone_name]))
  const faults = tickets.filter((t) => t.event_type === 'fault_repair')
  const downtime = sum(tickets, (t) => t.downtime_hours)
  const exposure = sum(faults, (t) => t.est_exposure)
  const filtersOn = type || mfr || zone || theme || machine
  const unfiltered = !filtersOn && p.isFull

  const byMonth = p.months.map((mo) => {
    const ts = tickets.filter((t) => t.gaming_date?.startsWith(mo))
    return { month: mo, fault: sum(ts.filter((t) => t.event_type === 'fault_repair'), (t) => t.downtime_hours), other: sum(ts.filter((t) => t.event_type !== 'fault_repair'), (t) => t.downtime_hours), n: ts.length }
  })
  const agg = (pred: (t: Ticket) => boolean) => {
    const ts = tickets.filter(pred)
    return { count: ts.length, downtime: sum(ts, (t) => t.downtime_hours), exposure: sum(ts, (t) => t.est_exposure) }
  }
  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, ...agg((t) => t.local_hour === h) }))
  const byWd = WD.map((d) => ({ d, ...agg((t) => t.weekday === d) }))
  const mfrs = ['Halcyon', 'Northwind', 'Ridgeline']
  const fleet: Record<string, number> = { Halcyon: 115, Northwind: 101, Ridgeline: 94 }
  const byMfr = mfrs.map((m) => {
    const ts = faults.filter((t) => t.manufacturer === m)
    return { m, perMachine: ts.length / fleet[m], downtime: sum(ts, (t) => t.downtime_hours), exposure: sum(ts, (t) => t.est_exposure), response: ts.length ? sum(ts, (t) => t.response_hours) / ts.length : 0, repair: ts.length ? sum(ts, (t) => t.repair_hours) / ts.length : 0 }
  })
  const respBins = [[0, 0.01, 'Immediate'], [0.01, 0.5, '< 30 min'], [0.5, 1, '30–60 min'], [1, 2, '1–2 h'], [2, 4, '2–4 h'], [4, 1e9, '4 h +']] as const
  const respHist = respBins.map(([a, b, l]) => ({ l, n: tickets.filter((t) => t.response_hours >= a && t.response_hours < b).length }))
  const selM = sel ? machines.find((m) => m.machine_id === sel) : null
  const selTickets = sel ? tickets.filter((t) => t.machine_id === sel) : []

  const mCols: Column<MachineAgg>[] = [
    { key: 'machine_id', label: 'Machine', render: (m) => <span className="strong">{m.machine_id}</span> },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'zone', label: 'Zone', value: (m) => zn[m.zone_id] ?? m.zone_id },
    { key: 'tickets', label: 'Tickets', num: true },
    { key: 'downtime', label: 'Downtime', num: true, render: (m) => hours(m.downtime) },
    { key: 'avg_downtime', label: 'Avg / ticket', num: true, render: (m) => hours(m.avg_downtime) },
    { key: 'avg_response', label: 'Avg response', num: true, render: (m) => hours(m.avg_response) },
    { key: 'cost', label: 'Direct repair cost', num: true, render: (m) => usd(m.cost) },
    { key: 'theo_per_hour', label: 'Theo / avail hr', num: true, render: (m) => usd(m.theo_per_hour) },
    { key: 'exposure', label: 'Est. exposure', num: true, title: 'Fault downtime × machine theo per available hour (estimate)', render: (m) => <b className="strong">{usd(m.exposure)}</b> },
  ]
  const tCols: Column<Ticket>[] = [
    { key: 'opened_at_local', label: 'Opened (local)' },
    { key: 'gaming_date', label: 'Gaming date' },
    { key: 'machine_id', label: 'Machine', render: (t) => <span className="strong">{t.machine_id}</span> },
    { key: 'event_type', label: 'Category', value: (t) => TYPE_LABEL[t.event_type] ?? t.event_type },
    { key: 'manufacturer', label: 'Mfr' },
    { key: 'zone', label: 'Zone', value: (t) => zn[t.zone_id] ?? t.zone_id },
    { key: 'response_hours', label: 'Response', num: true, render: (t) => hours(t.response_hours) },
    { key: 'repair_hours', label: 'Repair', num: true, render: (t) => hours(t.repair_hours) },
    { key: 'downtime_hours', label: 'Downtime', num: true, render: (t) => hours(t.downtime_hours) },
    { key: 'direct_cost', label: 'Cost', num: true, render: (t) => usd(t.direct_cost) },
    { key: 'est_exposure', label: 'Est. exposure', num: true, render: (t) => t.est_exposure === null ? <span className="muted">n/a</span> : usd(t.est_exposure) },
  ]

  return (
    <div>
      <PageHead eyebrow="Q3 · Maintenance intelligence" title="How much play was lost to downtime, and when?"
        question="Every operations ticket timed from opened → work started → machine available, valued at the machine's own theoretical win per available hour." />

      <Callout title="Estimated exposure, not lost revenue" tone="warn">
        <b>Estimated lost exposure = downtime hours × machine theoretical win per available hour.</b> It assumes the machine would have been played at its average rate.
        Real loss is likely lower: displaced players often move to another machine, and many faults occur in quiet hours. Exposure is computed for <b>fault repairs only</b>; installs, moves, scheduled maintenance and retirements are planned events.
        Note: the headline <b>1,226</b> counts all operations tickets; {num(data.summary.fault_repairs as number)} of them are fault repairs.
      </Callout>

      <div className="filters mt">
        <Select label="Category" value={type} onChange={setType} allLabel="All tickets" options={Object.keys(data.summary.by_type as Record<string, number>).map((k) => ({ value: k, label: `${TYPE_LABEL[k] ?? k} (${(data.summary.by_type as Record<string, number>)[k]})` }))} />
        <Select label="Manufacturer" value={mfr} onChange={setMfr} allLabel="All" options={mfrs.map((m) => ({ value: m, label: m }))} />
        <Select label="Zone" value={zone} onChange={setZone} allLabel="All zones" options={q2.data.zones.map((z) => ({ value: z.zone_id, label: z.zone_name }))} />
        <Select label="Theme" value={theme} onChange={setTheme} allLabel="All themes" options={[...new Set(q2.data.theme_month.map((t) => t.theme))].sort().map((t) => ({ value: t, label: t }))} />
        <label className="ctrl">Machine<input type="search" placeholder="e.g. M-1065" value={machine} onChange={(e) => setMachine(e.target.value)} style={{ width: 120 }} /></label>
        {filtersOn && <button className="btn sm" onClick={() => { setType(''); setMfr(''); setZone(''); setTheme(''); setMachine('') }}>Reset filters</button>}
        <span className="small muted">Dates follow the global analysis period ({p.label}).</span>
      </div>

      <div className="kpis">
        <Kpi label="Tickets" metric="tickets" value={num(tickets.length)} sub={`${num(faults.length)} fault repairs`} verified={unfiltered} tip="Rows in operations within the filters (gaming date of opened_at)." />
        <Kpi label="Total downtime" metric="downtime" value={hours(downtime)} verified={unfiltered} tip="Σ (available_at_utc − opened_at_utc)." />
        <Kpi label="Avg downtime / ticket" value={hours(downtime / (tickets.length || 1))} verified={unfiltered} tip="Mean of per-ticket downtime." />
        <Kpi label="Avg response time" value={hours(sum(tickets, (t) => t.response_hours) / (tickets.length || 1))} verified={unfiltered} tip="Mean of (work_started_at − opened_at). Response is a minority of downtime; most is repair time." />
        <Kpi label="Est. lost-play exposure" value={usd(exposure)} sub="fault repairs · estimate" tip="Σ fault downtime × machine theo/available hour. An estimate of expected house win foregone, not actual revenue." />
        <Kpi label="Direct repair cost" value={usd(sum(faults, (t) => t.direct_cost))} sub="operations.direct_cost_cents ÷ 100" tip="Parts and labour charged to the ticket, per cost_rules CR-REPAIR." />
      </div>

      <div className="grid g3 mt">
        <Panel title="Downtime by month" sub="Hours · fault repairs vs planned work" source={{ tables: ['2_machine_decision/operations', '2_machine_decision/calendar_day'], fields: ['opened_at_utc', 'available_at_utc', 'event_type'], calc: 'Ticket assigned to the gaming date (6am–6am local) of opened_at_utc.' }}>
          <div className="legend"><span className="lg"><span className="sw" style={{ background: SERIES[1] }} />Fault repair</span><span className="lg"><span className="sw" style={{ background: SERIES[0] }} />Other</span></div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={byMonth} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} tickFormatter={mLabel} />
                <YAxis {...axisProps} width={40} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => hours(v, 1)} labelFmt={(l) => mLabel(String(l))} />} />
                <Bar dataKey="fault" name="Fault repair" stackId="a" fill={SERIES[1]} isAnimationActive={false} />
                <Bar dataKey="other" name="Other" stackId="a" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="When faults are opened" sub="Local hour of day" source={{ tables: ['2_machine_decision/operations'], fields: ['opened_at_local'] }}>
          <Seg value={hourMetric} onChange={setHourMetric} label="Hour metric" options={[{ value: 'downtime', label: 'Downtime h' }, { value: 'count', label: 'Tickets' }, { value: 'exposure', label: 'Est. exposure' }]} />
          <div style={{ height: 200, marginTop: 6 }}>
            <ResponsiveContainer>
              <BarChart data={byHour} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="h" {...axisProps} interval={3} tickFormatter={(h) => `${h}h`} />
                <YAxis {...axisProps} width={44} tickFormatter={(v) => hourMetric === 'exposure' ? `$${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => hourMetric === 'downtime' ? hours(v, 1) : hourMetric === 'exposure' ? usd(v, 0) : num(v)} labelFmt={(l) => `${l}:00–${l}:59 local`} />} />
                <Bar dataKey={hourMetric} name={hourMetric === 'downtime' ? 'Downtime' : hourMetric === 'count' ? 'Tickets' : 'Est. exposure'} fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="By gaming weekday" sub="Downtime hours" source={{ tables: ['2_machine_decision/operations', '2_machine_decision/calendar_day'] }}>
          <div style={{ height: 222 }}>
            <ResponsiveContainer>
              <BarChart data={byWd} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="d" {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v, k) => k === 'exposure' ? usd(v, 0) : hours(v, 1)} extra={(pl) => <div className="small muted">{num(Number(pl.count))} tickets · {usd(Number(pl.exposure), 0)} est. exposure</div>} />} />
                <Bar dataKey="downtime" name="Downtime" fill={SERIES[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Manufacturer reliability" sub="Fault repairs only · fleet sizes from machines registry" tip="Tickets per machine normalises for fleet size. Ridgeline's rate is the clearest operational 'leak' on the floor."
          source={{ tables: ['2_machine_decision/operations', '2_machine_decision/machines'], fields: ['manufacturer', 'event_type', 'downtime'] }}>
          <div className="table-wrap"><table className="dt"><thead><tr><th>Manufacturer</th><th className="num">Repairs / machine</th><th className="num">Downtime</th><th className="num">Avg response</th><th className="num">Avg repair</th><th className="num">Est. exposure</th></tr></thead>
            <tbody>{byMfr.map((m) => <tr key={m.m} className="clickable" onClick={() => setMfr(mfr === m.m ? '' : m.m)}><td className={mfr === m.m ? 'strong' : ''}>{m.m}</td><td className="num"><b className="strong">{m.perMachine.toFixed(2)}</b></td><td className="num">{hours(m.downtime, 1)}</td><td className="num">{hours(m.response)}</td><td className="num">{hours(m.repair)}</td><td className="num">{usd(m.exposure, 0)}</td></tr>)}</tbody></table></div>
          <p className="small muted mt-s">Response time (opened → work started) is ~{pct(sum(faults, (t) => t.response_hours) / (sum(faults, (t) => t.downtime_hours) || 1), 0)} of fault downtime; the rest is repair time. Faster response alone (an extra technician) can recover only that share — see <Link to="/recommendations">Recommendations</Link>.</p>
        </Panel>
        <Panel title="Response-time distribution" sub="Tickets by time from opened to work started" source={{ tables: ['2_machine_decision/operations'], fields: ['opened_at_utc', 'work_started_at_utc'] }}>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={respHist} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="l" {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTip fmt={(v) => `${num(v)} tickets`} />} />
                <Bar dataKey="n" name="Tickets" radius={[3, 3, 0, 0]} isAnimationActive={false}>{respHist.map((_, i) => <Cell key={i} fill={i >= 4 ? SERIES[1] : SERIES[0]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel className="mt" title="Machine downtime ranking" sub="Click a machine to see its tickets" source={{ tables: ['2_machine_decision/operations', '1_prepared_views/prepared_daily_view'], fields: ['downtime', 'theo_usd', 'available_hours'], calc: 'Theo / avail hr = Σ theo_usd ÷ Σ available_hours over reported meter days (whole Jan–Jun), as in the team\'s analyze_maintenance.py.' }}>
        <DataTable rows={machines} columns={mCols} rowKey={(m) => m.machine_id} searchKeys={['machine_id', 'manufacturer']} initialSort={{ key: 'exposure', dir: 'desc' }}
          onRowClick={(m) => setSel(m.machine_id)} selectedKey={sel} csvName={`q3_machine_downtime_${p.key}`} pageSize={10} />
      </Panel>

      {selM && (
        <Panel className="mt detail" title={`${selM.machine_id} · ${selM.manufacturer} · ${zn[selM.zone_id] ?? ''}`} sub={`${selM.tickets} tickets · ${hours(selM.downtime)} downtime · ${usd(selM.exposure)} est. exposure · ${usd(selM.theo_per_hour)} theo / available hour`}
          actions={<><Link className="btn sm" to="/q1">Q1 ranking →</Link><button className="btn sm" onClick={() => setSel(null)}>Close ✕</button></>}>
          <DataTable rows={selTickets} columns={tCols} rowKey={(t) => t.operation_id} initialSort={{ key: 'opened_at_local', dir: 'asc' }} pageSize={8} csvName={`q3_${selM.machine_id}_tickets`} />
        </Panel>
      )}

      <Panel className="mt" title="Repair event log" sub={`${num(tickets.length)} tickets in view`} source={{ tables: ['2_machine_decision/operations'], fields: ['operation_id', 'machine_id', 'event_type', 'opened_at_local', 'work_started_at_utc', 'available_at_utc', 'direct_cost_cents'] }}>
        <DataTable rows={tickets} columns={tCols} rowKey={(t) => t.operation_id} searchKeys={['machine_id', 'operation_id', 'event_type', 'bank_id', 'location_id']} initialSort={{ key: 'downtime_hours', dir: 'desc' }} pageSize={12}
          onRowClick={(t) => setSel(t.machine_id)} csvName={`q3_tickets_${p.key}`} />
      </Panel>
      <p className="small muted mt-s">Highest single-machine downtime in the full half-year: M-1065 (81.11 h). Bar colour <span style={{ color: GOLD }}>gold</span> marks selections elsewhere in the dashboard.</p>
    </div>
  )
}
