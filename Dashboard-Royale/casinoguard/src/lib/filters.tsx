import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MONTHS, usePeriod } from './period'

/*
 * Global filters shared by every interactive view. The month range lives in PeriodProvider (lib/period.tsx);
 * this adds casino zone, machine theme, the headline metric, and historical playback over the months.
 */

export interface Filters {
  zone: string
  theme: string
  metric: string
  setZone: (z: string) => void
  setTheme: (t: string) => void
  setMetric: (m: string) => void
  /** Cross-filter helper: selecting the active value again clears it. */
  toggleZone: (z: string) => void
  toggleTheme: (t: string) => void
  clear: () => void
  active: number
  playback: {
    playing: boolean
    /** Month index shown while scrubbing or playing, null when not in playback. */
    index: number | null
    play: () => void
    pause: () => void
    seek: (i: number) => void
    exit: () => void
  }
}

const Ctx = createContext<Filters | null>(null)
const KEY = 'cg-filters'
const STEP_MS = 1600

function readInitial() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { zone: String(v.zone ?? ''), theme: String(v.theme ?? ''), metric: String(v.metric ?? 'coin_in') }
  } catch {
    return { zone: '', theme: '', metric: 'coin_in' }
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const period = usePeriod()
  const [state, setState] = useState(readInitial)
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState<number | null>(null)
  const saved = useRef<[number, number] | null>(null)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  }, [state])

  const { setRange } = period
  const seek = useCallback((i: number) => {
    if (saved.current === null) saved.current = [period.m0, period.m1]
    const c = Math.max(0, Math.min(MONTHS.length - 1, i))
    setIndex(c)
    setRange(c, c)
  }, [period.m0, period.m1, setRange])

  // Choosing a period by hand leaves playback.
  useEffect(() => {
    if (index !== null && (period.m0 !== index || period.m1 !== index)) {
      setPlaying(false)
      setIndex(null)
      saved.current = null
    }
  }, [period.m0, period.m1, index])

  // Advance one month per step while playing; stop at the last month.
  useEffect(() => {
    if (!playing || index === null) return
    if (index >= MONTHS.length - 1) { setPlaying(false); return }
    const t = window.setTimeout(() => seek(index + 1), STEP_MS)
    return () => window.clearTimeout(t)
  }, [playing, index, seek])

  const value = useMemo<Filters>(() => {
    const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, ...patch }))
    return {
      ...state,
      setZone: (zone) => set({ zone }),
      setTheme: (theme) => set({ theme }),
      setMetric: (metric) => set({ metric }),
      toggleZone: (z) => setState((s) => ({ ...s, zone: s.zone === z ? '' : z })),
      toggleTheme: (t) => setState((s) => ({ ...s, theme: s.theme === t ? '' : t })),
      clear: () => set({ zone: '', theme: '' }),
      active: (state.zone ? 1 : 0) + (state.theme ? 1 : 0),
      playback: {
        playing,
        index,
        play: () => {
          // Restart from January when starting at the end or outside playback.
          const start = index === null || index >= MONTHS.length - 1 ? 0 : index
          seek(start)
          setPlaying(true)
        },
        pause: () => setPlaying(false),
        seek: (i) => { setPlaying(false); seek(i) },
        exit: () => {
          setPlaying(false)
          setIndex(null)
          const r = saved.current ?? [0, MONTHS.length - 1]
          saved.current = null
          setRange(r[0], r[1])
        },
      },
    }
  }, [state, playing, index, seek, setRange])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useFilters(): Filters {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFilters outside provider')
  return v
}
