import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { mLabel } from './format'

export const MONTHS = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06']
const DAYS_IN = [31, 28, 31, 30, 31, 30]

export interface Period {
  m0: number
  m1: number
  months: string[]
  /** "a-b" — index into ranges precomputed by the pipeline */
  key: string
  isFull: boolean
  label: string
  start: string
  end: string
  days: number
  setRange: (a: number, b: number) => void
  reset: () => void
  inRange: (dateOrMonth: string | null | undefined) => boolean
}

const Ctx = createContext<Period | null>(null)

function readInitial(): [number, number] {
  try {
    const v = localStorage.getItem('cg-period')
    if (v) {
      const [a, b] = v.split('-').map(Number)
      if (a >= 0 && b <= 5 && a <= b) return [a, b]
    }
  } catch {
    /* storage unavailable */
  }
  return [0, 5]
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [[m0, m1], set] = useState<[number, number]>(readInitial)
  const value = useMemo<Period>(() => {
    const months = MONTHS.slice(m0, m1 + 1)
    const setRange = (a: number, b: number) => {
      const lo = Math.max(0, Math.min(a, b))
      const hi = Math.min(5, Math.max(a, b))
      set([lo, hi])
      try {
        localStorage.setItem('cg-period', `${lo}-${hi}`)
      } catch {
        /* ignore */
      }
    }
    return {
      m0,
      m1,
      months,
      key: `${m0}-${m1}`,
      isFull: m0 === 0 && m1 === 5,
      label: m0 === m1 ? `${mLabel(MONTHS[m0])} 2025` : `${mLabel(MONTHS[m0])}–${mLabel(MONTHS[m1])} 2025`,
      start: `${MONTHS[m0]}-01`,
      end: `${MONTHS[m1]}-${DAYS_IN[m1]}`,
      days: DAYS_IN.slice(m0, m1 + 1).reduce((a, b) => a + b, 0),
      setRange,
      reset: () => setRange(0, 5),
      inRange: (d) => !!d && months.includes(d.slice(0, 7)),
    }
  }, [m0, m1])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePeriod(): Period {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePeriod outside provider')
  return v
}
