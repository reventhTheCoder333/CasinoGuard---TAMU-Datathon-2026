/*
 * One registry of metric definitions: formula, how it is calculated here, and where the data comes from.
 * Floor metrics have a `value` function over an Agg (lib/floor.ts) and can drive the Explorer charts;
 * the others document KPIs computed on the existing pages and are shown by their explanation panels.
 * Wording follows the tips and source boxes already on the Q1–Q5 pages.
 */
import type { Agg } from './floor'
import { hours, num, pct, usd, usdShort } from './format'

export interface MetricDef {
  id: string
  label: string
  formula: string
  calc: string
  tables: string[]
  fields?: string[]
  note?: string
  /** Floor metrics only */
  value?: (a: Agg) => number
  fmt: (v: number) => string
  axis?: (v: number) => string
  /** true when bigger is worse (faults, repair cost) */
  lowerIsBetter?: boolean
}

const MM = 'q1.json machine_month (built from 1_prepared_views/prepared_daily_view)'
const ratio = (a: number, b: number) => (b ? a / b : NaN)

export const FLOOR_METRICS: MetricDef[] = [
  {
    id: 'coin_in', label: 'Coin-in', formula: 'Σ coin_in_usd',
    calc: 'Sum of coin-in over the machine-month rows that match the filters.',
    tables: [MM], fields: ['coin_in_usd'], value: (a) => a.coin_in, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
  {
    id: 'theo', label: 'Theoretical win', formula: 'Σ theo_usd  (= coin-in × (1 − RTP))',
    calc: 'Expected house win given each machine\'s configured RTP, summed over matching machine-months.',
    tables: [MM], fields: ['theo_usd'], value: (a) => a.theo, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
  {
    id: 'house_win', label: 'Actual house win', formula: 'Σ house_win_usd  (= coin-in − payout)',
    calc: 'What the machines actually kept. Differs from theo by luck.',
    tables: [MM], fields: ['house_win_usd'], value: (a) => a.house_win, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
  {
    id: 'hold', label: 'Actual hold %', formula: 'Σ house_win_usd ÷ Σ coin_in_usd',
    calc: 'Ratio of sums over matching machine-months, so large machines weigh more.',
    tables: [MM], fields: ['house_win_usd', 'coin_in_usd'], value: (a) => ratio(a.house_win, a.coin_in), fmt: (v) => pct(v, 2), axis: (v) => pct(v, 1),
  },
  {
    id: 'occupancy', label: 'Occupancy', formula: 'Σ occupied_hours ÷ Σ available_hours',
    calc: 'Share of available machine-hours in which the machine was in play (ratio of sums).',
    tables: [MM], fields: ['occupied_hours', 'available_hours'], value: (a) => ratio(a.occupied_hours, a.available_hours), fmt: (v) => pct(v, 1), axis: (v) => pct(v, 0),
  },
  {
    id: 'theo_per_hour', label: 'Theo win / avail hr', formula: 'Σ theo_usd ÷ Σ available_hours',
    calc: 'Exposure-adjusted earning power: the Q1 ranking metric, pooled over the matching rows.',
    tables: [MM], fields: ['theo_usd', 'available_hours'], value: (a) => ratio(a.theo, a.available_hours), fmt: (v) => usd(v), axis: (v) => `$${v.toFixed(0)}`,
  },
  {
    id: 'coin_per_hour', label: 'Coin-in / avail hr', formula: 'Σ coin_in_usd ÷ Σ available_hours',
    calc: 'Demand per unit of exposure, as used for zones and themes in Q2.',
    tables: [MM], fields: ['coin_in_usd', 'available_hours'], value: (a) => ratio(a.coin_in, a.available_hours), fmt: (v) => usd(v), axis: (v) => `$${v.toFixed(0)}`,
  },
  {
    id: 'luck', label: 'Luck (actual − theo)', formula: 'Σ luck_residual_usd  (= house win − theo)',
    calc: 'Positive means the machines kept more than their math predicts.',
    tables: [MM], fields: ['luck_residual_usd'], value: (a) => a.luck, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
  {
    id: 'contribution', label: 'Contribution after supplied costs', formula: 'Σ contribution_after_supplied_costs_usd',
    calc: 'The prepared view\'s contribution after the challenge\'s supplied costs, summed over matching machine-months.',
    tables: [MM], fields: ['contribution_after_supplied_costs_usd'], value: (a) => a.contribution, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
  {
    id: 'faults', label: 'Faults', formula: 'Σ faults_opened', lowerIsBetter: true,
    calc: 'Faults opened on matching machines in the matching months.',
    tables: [MM], fields: ['faults_opened'], value: (a) => a.faults, fmt: (v) => num(v), axis: (v) => num(v),
  },
  {
    id: 'repair_cost', label: 'Repair cost', formula: 'Σ repair_cost_usd', lowerIsBetter: true,
    calc: 'Repair cost recorded against matching machines in the matching months.',
    tables: [MM], fields: ['repair_cost_usd'], value: (a) => a.repair_cost, fmt: (v) => usd(v, 0), axis: (v) => usdShort(v, 0),
  },
]

/** Explanations for KPIs that live on the existing pages (not sliceable by zone or theme). */
export const PAGE_METRICS: MetricDef[] = [
  { id: 'tracked_net', label: 'Tracked casino net', formula: 'Σ tracked_coin_in_usd − Σ tracked_payout_usd', calc: 'Wagering minus payouts for carded (tracked) play in the selected months.', tables: ['3_players/player_period'], fields: ['tracked_coin_in_usd', 'tracked_payout_usd'], fmt: (v) => usd(v) },
  { id: 'tracked_wager', label: 'Tracked wagering', formula: 'Σ tracked_coin_in_usd', calc: 'Coin-in recorded against a loyalty card in the selected months.', tables: ['3_players/player_period'], fields: ['tracked_coin_in_usd'], fmt: (v) => usd(v) },
  { id: 'tracked_payout', label: 'Tracked payouts', formula: 'Σ tracked_payout_usd', calc: 'Payouts on carded play in the selected months.', tables: ['3_players/player_period'], fields: ['tracked_payout_usd'], fmt: (v) => usd(v) },
  { id: 'tickets', label: 'Operations tickets', formula: 'count(operations rows)', calc: 'Tickets whose opened_at falls on a gaming date in the selected months.', tables: ['2_operations/operations'], fields: ['operation_id', 'opened_at_utc', 'event_type'], fmt: (v) => num(v) },
  { id: 'downtime', label: 'Total downtime', formula: 'Σ (available_at_utc − opened_at_utc)', calc: 'Hours from ticket opening until the machine was available again, summed.', tables: ['2_operations/operations'], fields: ['opened_at_utc', 'available_at_utc'], fmt: (v) => hours(v) },
  { id: 'comp_cost', label: 'Actual comp cost', formula: 'Σ comp_cost_usd', calc: 'Economic cost of comps; reconciles to property_day and loyalty_ledger.', tables: ['3_players/player_period', '1_prepared_views/property_day'], fields: ['comp_cost_usd'], fmt: (v) => usd(v) },
  { id: 'comp_face', label: 'Comp face value', formula: 'Σ comp_face_value_usd', calc: 'Menu value of comps redeemed — not cash spent.', tables: ['3_players/player_period'], fields: ['comp_face_value_usd'], fmt: (v) => usd(v) },
  { id: 'prop_coin', label: 'Property coin-in', formula: 'Σ coin_in_usd', calc: 'All machine play (carded and uncarded) by gaming date.', tables: ['1_prepared_views/property_day'], fields: ['coin_in_usd'], fmt: (v) => usd(v) },
]

export const METRICS: Record<string, MetricDef> = Object.fromEntries([...FLOOR_METRICS, ...PAGE_METRICS].map((m) => [m.id, m]))
export const metricDef = (id: string) => METRICS[id] ?? FLOOR_METRICS[0]
