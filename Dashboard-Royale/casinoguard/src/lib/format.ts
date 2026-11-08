const cache = new Map<number, Intl.NumberFormat>()
const f = (dp: number) => {
  let x = cache.get(dp)
  if (!x) {
    x = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    cache.set(dp, x)
  }
  return x
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Full-precision currency, e.g. $15,585,460.60 */
export function usd(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return '—'
  const s = f(dp).format(Math.abs(v))
  return (v < 0 ? '−$' : '$') + s
}
/** Compact currency for axes and dense UI, e.g. $15.6M */
export function usdShort(v: number | null | undefined, dp = 1): string {
  if (!isNum(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(dp)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(dp)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(dp)}k`
  return `${sign}$${a.toFixed(a < 10 && a % 1 ? 2 : 0)}`
}
export function num(v: number | null | undefined, dp = 0): string {
  if (!isNum(v)) return '—'
  return (v < 0 ? '−' : '') + f(dp).format(Math.abs(v))
}
/** Fraction → percent string: 0.2511 → 25.11% */
export function pct(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return '—'
  return `${(v * 100).toFixed(dp)}%`
}
/** Already-percent value → string: 15.73 → 15.73% */
export function pctv(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return '—'
  return `${v.toFixed(dp)}%`
}
export function signedPct(v: number | null | undefined, dp = 1): string {
  if (!isNum(v)) return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`
}
export function hours(v: number | null | undefined, dp = 2): string {
  if (!isNum(v)) return '—'
  return `${num(v, dp)} h`
}
export const sum = <T,>(rows: T[], fn: (r: T) => number | null | undefined) =>
  rows.reduce((a, r) => {
    const x = fn(r)
    return a + (isNum(x) ? x : 0)
  }, 0)
export const safeDiv = (a: number, b: number) => (b ? a / b : NaN)
export const MONTH_LABELS: Record<string, string> = {
  '2025-01': 'Jan', '2025-02': 'Feb', '2025-03': 'Mar', '2025-04': 'Apr', '2025-05': 'May', '2025-06': 'Jun', '2025-07': 'Jul',
}
export const mLabel = (m: string) => MONTH_LABELS[m] ?? m
export const dLabel = (d: string) => {
  const [, mm, dd] = d.split('-')
  return `${MONTH_LABELS['2025-' + mm] ?? mm} ${Number(dd)}`
}
