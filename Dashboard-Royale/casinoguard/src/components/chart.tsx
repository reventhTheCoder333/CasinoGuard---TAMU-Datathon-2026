/* Shared chart styling for Recharts (dark surface, validated categorical order). */
import type { ReactNode } from 'react'

export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']
export const GOLD = '#d4b169'
export const MUTED = '#5b6270'
export const GRID = '#232935'
export const AXIS = '#858479'

/** Fixed zone → color mapping so a zone keeps its color under every filter. */
export const ZONE_COLORS: Record<string, string> = {
  'Z-B40': SERIES[1],
  'Z-BAR': SERIES[0],
  'Z-ENT': SERIES[2],
  'Z-GAR': SERIES[3],
  'Z-HL': SERIES[4],
  'Z-HTL': SERIES[5],
  'Z-PIT': SERIES[6],
}
export const TIER_COLORS: Record<string, string> = { Base: SERIES[0], Gold: SERIES[3], Platinum: SERIES[6] }

export const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const

export const gridProps = { stroke: GRID, strokeDasharray: '0', vertical: false } as const

type TipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown>; stroke?: string; fill?: string }

/** Tooltip with values leading and line keys, per the house chart spec. */
export function ChartTip({
  active, payload, label, fmt, labelFmt, extra,
}: {
  active?: boolean
  payload?: TipPayload[]
  label?: string | number
  fmt?: (v: number, key?: string) => string
  labelFmt?: (l: string | number, p?: Record<string, unknown>) => ReactNode
  extra?: (p: Record<string, unknown>) => ReactNode
}) {
  if (!active || !payload || !payload.length) return null
  const p0 = payload[0]?.payload ?? {}
  return (
    <div className="chart-tip">
      <div className="tt-title">{labelFmt ? labelFmt(label ?? '', p0) : label}</div>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p, i) => (
        <div className="tt-row" key={i}>
          <span className="tt-key" style={{ background: p.color ?? p.stroke ?? p.fill }} />
          <span className="tt-val">{typeof p.value === 'number' ? (fmt ? fmt(p.value, String(p.dataKey)) : p.value.toLocaleString()) : p.value}</span>
          <span className="tt-name">{p.name}</span>
        </div>
      ))}
      {extra && extra(p0)}
    </div>
  )
}
