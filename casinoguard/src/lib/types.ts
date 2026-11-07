// Shapes of the JSON files produced by pipeline/build_data.py

export interface Check { name: string; computed: number; expected: number; ok: boolean; source: string }
export interface Meta {
  generated_at: string
  data_release: string
  coverage: Record<string, number | string | null>
  checks: Check[]
  checks_passed: number
  checks_total: number
}

export interface PropertyDay {
  gaming_date: string; local_weekday: string; events_active: string; active_machines: number
  coin_in_usd: number; payout_usd: number; house_win_usd: number; theo_usd: number
  comp_cost_usd: number; comp_face_value_usd: number; faults_opened: number
  total_zone_entries_observed: number; counter_coverage_share: number; carded_coin_in_share: number
  contribution_after_supplied_costs_usd: number; available_machine_hours: number; occupied_machine_hours: number
}
export interface Overview { kpis: Record<string, number>; daily: PropertyDay[] }

export interface MachineStatic {
  machine_id: string; theme: string; config_id: string; manufacturer: string; lease_class: string
  configured_rtp: number; volatility: string; zone_id: string; zone_name: string; bank_id: string; location_id: string
  install_date: string; retire_date: string | null; locations_used: number
}
export interface MachineMonth {
  machine_id: string; month: string; days: number; active_days: number; sched_hours: number
  available_hours: number; occupied_hours: number; coin_in: number; theo: number; house_win: number; luck: number
  repair_cost: number; faults: number; contribution: number; spins: number
  zone_id: string | null; bank_id: string | null; location_id: string | null
}
export interface Q1Data {
  machines: MachineStatic[]
  machine_month: MachineMonth[]
  weekly: Record<string, [string, number, number, number, number, number][]>
  weekly_columns: string[]
  team_top10: string[]
  naive_bottom10: { machine_id: string; house_win: number }[]
  config: Record<string, string | number>[]
}

export interface ZoneMonth {
  month: string; zone_id: string; zone_name: string; coin_in: number; theo: number; spins: number
  occupied_hours: number; available_hours: number; machines: number; machine_days: number; days: number
  entries: number | null; coverage_hours: number | null
}
export interface Q2Data {
  zones: { zone_id: string; zone_name: string }[]
  zone_month: ZoneMonth[]
  bank_month: { month: string; bank_id: string; zone_id: string; coin_in: number; occupied_hours: number; available_hours: number; machines: number; days: number }[]
  theme_month: { month: string; theme: string; coin_in: number; occupied_hours: number; available_hours: number; machines: number; days: number }[]
  theme_zone_month: { month: string; theme: string; zone_id: string; coin_in: number; occupied_hours: number; available_hours: number }[]
  zone_daily: Record<string, [string, number, number, number, number | null, number | null][]>
  traffic_demand_corr: Record<string, number>
  hourly_by_zone: { local_hour: number; zone_id: string; total_coin_in: number; occupied_hours: number; available_hours: number; coin_in_per_available_hour: number; occupancy_rate: number }[]
  weekday_weekend: { is_weekend: string; zone_id: string; coin_in: number; occupied_hours: number; available_hours: number; days: number }[]
  events: { event_id: string; name: string; event_type: string; start_date: string; end_date: string; announced_date: string; local_scope: string }[]
  city_monthly: Record<string, number | string>[]
}

export interface Ticket {
  operation_id: string; machine_id: string; manufacturer: string; zone_id: string; bank_id: string; location_id: string
  event_type: string; gaming_date: string; opened_at_local: string; local_hour: number; weekday: string
  downtime_hours: number; response_hours: number; repair_hours: number; direct_cost: number
  theo_per_hour: number; est_exposure: number | null
}
export interface Q3Data { tickets: Ticket[]; summary: Record<string, number | Record<string, number>> }

export interface RangeSummary {
  players: number; wager: number; payout: number; casino_net: number; theo: number; luck: number
  losers: number; winners: number; even: number; gross_losses: number; winnings_paid: number
  loss_share: Record<string, number>; wager_share: Record<string, number>
  gini_wager: number; gini_losses: number
  lorenz_wager: [number, number][]; lorenz_losses: [number, number][]
  net_histogram: { bin: string; players: number }[]
  median_wager: number; mean_wager: number
}
export interface SegmentRow { segment: string; players: number; wager: number; payout: number; net: number; theo: number; hours: number; comp_cost: number; losers: number; winners: number }
export interface Q4Data {
  ranges: Record<string, RangeSummary>
  segments: Record<string, Record<string, SegmentRow[]>>
  percentile_groups: { group: string; players: number; wager: number; payout: number; casino_net: number; theo: number; hours: number; comp_cost: number; losers: number; winners: number; median_net: number }[]
  top_players: { alias: string; tier_end: string; home_region: string; age_band: string; wager: number; payout: number; casino_net: number; theo: number; luck: number; hours: number; sessions: number }[]
  monthly: { period_month: string; players: number; wager: number; payout: number; theo: number; hours: number; casino_net: number }[]
  months: string[]
}

export interface Q5Month {
  month: string; comp_cost: number; face: number; redemptions: number; players: number; tracked_theo: number
  points_earned: number; points_redeemed: number; redeeming_players: number
  prop_comp_cost: number; prop_face: number; prop_theo: number; days: number
  cost_pct_tracked_theo: number; cost_pct_property_theo: number
}
export interface Q5Data {
  monthly: Q5Month[]
  ledger_utc_month: { utc_month: string; event_type: string; events: number; points: number; cost: number; face: number }[]
  ledger_daily: { gaming_date: string; redemptions: number; points: number; face: number; cost: number; points_per_face_dollar: number; awards: number; award_points: number }[]
  points_per_dollar_by_tier: { tier_before: string; month: string; points_per_face_dollar: number }[]
  benefits: { benefit_id: string; month: string; n: number; avg_points: number; face: number; cost: number }[]
  tier_transitions: { month: string; path: string; n: number }[]
  tier_paths: Record<string, number>
  tier_cost: { tier_end: string; players: number; comp_cost: number; face: number; theo: number; redemptions: number }[]
  reconciliation: { source: string; table: string; fields: string; economic_cost: number; face_value: number; redemptions: number | null }[]
  summary: Record<string, number>
}

export interface ForecastModel { id: string; name: string; kind: string; mae: number; mape: number; mae_gain_vs_weekday: number; gain_se: number; days_better_than_weekday: number; gain_ci95: [number, number]; phi?: number }
export interface ForecastData {
  freeze_date: string; train: [string, string]; holdout: [string, string]; n_train: number; n_test: number
  models: ForecastModel[]
  coef: Record<string, number>
  known_events: { event_id: string; name: string; start_date: string; end_date: string; announced_date: string }[]
  excluded_events: { event_id: string; name: string; announced_date: string }[]
  series: { gaming_date: string; local_weekday: string; coin_in_usd: number; split: string; fit_weekday?: number; fit_regression?: number; pred_mean?: number; pred_weekday?: number; pred_ar?: number; pred_regression?: number }[]
  weekday_profile: { weekday: string; train_avg: number; holdout_avg: number }[]
}

export interface PricedAction {
  action_type_id: string; name: string; unit: string; quantity: number; unit_cost: number; recurring_per_day: number
  lead_days: number; operating_days: number; downtime_minutes: number; quantity_limit: number
  incompatibility_group: string | null; notes: string; total_cost: number
}
export interface RecsData {
  budget: number; horizon_days: number; spent: number; preserved: number
  selected: PricedAction[]; alternatives: PricedAction[]
  catalog: Record<string, string | number | null>[]
  cost_rules: Record<string, string | number | null>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evidence: Record<string, any>
}
