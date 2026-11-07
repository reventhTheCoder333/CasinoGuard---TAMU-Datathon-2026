import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { MONTHS, PeriodProvider, usePeriod } from './lib/period'
import { mLabel } from './lib/format'
import Overview from './pages/Overview'
import Q1 from './pages/Q1'
import Q2 from './pages/Q2'
import Q3 from './pages/Q3'
import Q4 from './pages/Q4'
import Q5 from './pages/Q5'
import Recommendations from './pages/Recommendations'
import Methodology from './pages/Methodology'
import Model from './pages/Model'

export const NAV = [
  { to: '/', key: '◆', label: 'Overview', group: 'Executive' },
  { to: '/q1', key: 'Q1', label: 'Machine Performance', group: 'Analyses' },
  { to: '/q2', key: 'Q2', label: 'Floor Demand', group: 'Analyses' },
  { to: '/q3', key: 'Q3', label: 'Maintenance Intelligence', group: 'Analyses' },
  { to: '/q4', key: 'Q4', label: 'Player Financial Intelligence', group: 'Analyses' },
  { to: '/q5', key: 'Q5', label: 'Loyalty Intelligence', group: 'Analyses' },
  { to: '/recommendations', key: '$', label: 'Recommendations', group: 'Decisions' },
  { to: '/model', key: 'ML', label: 'Forecast Model', group: 'Decisions' },
  { to: '/methodology', key: '§', label: 'Methodology & Evidence', group: 'Decisions' },
]

const PRESETS: { label: string; a: number; b: number }[] = [
  { label: 'Jan–Jun', a: 0, b: 5 },
  { label: 'Q1', a: 0, b: 2 },
  { label: 'Q2', a: 3, b: 5 },
  { label: 'Jan–Apr', a: 0, b: 3 },
  { label: 'May–Jun', a: 4, b: 5 },
]

function PeriodPicker() {
  const p = usePeriod()
  return (
    <div className="row" style={{ gap: 8 }} aria-label="Analysis period">
      <span className="ctrl" style={{ color: 'var(--gold)', fontWeight: 600 }}>Analysis period</span>
      <div className="seg" role="group" aria-label="Period presets">
        {PRESETS.map((pr) => (
          <button key={pr.label} className={p.m0 === pr.a && p.m1 === pr.b ? 'on' : ''} onClick={() => p.setRange(pr.a, pr.b)}>
            {pr.label}
          </button>
        ))}
      </div>
      <select aria-label="From month" value={p.m0} onChange={(e) => p.setRange(Number(e.target.value), Math.max(Number(e.target.value), p.m1))}>
        {MONTHS.map((m, i) => <option key={m} value={i}>{mLabel(m)} 2025</option>)}
      </select>
      <span className="muted">to</span>
      <select aria-label="To month" value={p.m1} onChange={(e) => p.setRange(Math.min(p.m0, Number(e.target.value)), Number(e.target.value))}>
        {MONTHS.map((m, i) => <option key={m} value={i}>{mLabel(m)} 2025</option>)}
      </select>
      {!p.isFull && <button className="btn sm" onClick={p.reset}>Reset period</button>}
    </div>
  )
}

function Shell() {
  const loc = useLocation()
  const nav = useNavigate()
  const cur = NAV.find((n) => n.to === loc.pathname) ?? NAV[0]
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  let lastGroup = ''
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src="./favicon.svg" width={30} height={30} alt="" />
          <div>
            <div className="brand-name">CASINOGUARD</div>
            <div className="brand-sub">Financial intelligence · The Gilded Ace</div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => {
            const head = n.group !== lastGroup ? <div className="nav-group" key={`g-${n.group}`}>{n.group}</div> : null
            lastGroup = n.group
            return [
              head,
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="nav-key">{n.key}</span>
                {n.label}
              </NavLink>,
            ]
          })}
        </nav>
        <div className="sidebar-foot">
          Fictional casino · synthetic data<br />
          Dashboard Royale · TAMU Datathon
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="mobile-nav">
            <select aria-label="Navigate" value={cur.to} onChange={(e) => nav(e.target.value)}>
              {NAV.map((n) => <option key={n.to} value={n.to}>{n.key} · {n.label}</option>)}
            </select>
          </div>
          <span className="crumb">{cur.group} / <span className="secondary">{cur.label}</span></span>
          <span className="spacer" />
          <PeriodPicker />
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/q1" element={<Q1 />} />
            <Route path="/q2" element={<Q2 />} />
            <Route path="/q3" element={<Q3 />} />
            <Route path="/q4" element={<Q4 />} />
            <Route path="/q5" element={<Q5 />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/model" element={<Model />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<Overview />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <PeriodProvider>
        <Shell />
      </PeriodProvider>
    </HashRouter>
  )
}
