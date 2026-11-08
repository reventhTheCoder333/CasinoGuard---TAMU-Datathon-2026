# Calculations, definitions and data sources

All figures are produced by `pipeline/build_data.py` (and, for the period-adjustable Q1 ranking, `src/lib/q1.ts`). Money is summed at full precision and rounded to cents only for display.

## Money terms

| Term | Definition | Source |
| --- | --- | --- |
| Coin-in / wagering | Total wagered, including re-bet winnings | `coin_in_usd`, `tracked_coin_in_usd` |
| Payout | Total paid back by games | `payout_usd`, `tracked_payout_usd` |
| House win / casino net | Coin-in − payout | derived |
| Theo (theoretical win) | Coin-in × (1 − configured RTP): expected house win | `theo_usd` |
| Luck residual | Actual house win − theo | `luck_residual_usd` |
| Hold | House win ÷ coin-in (ratio of sums) | derived |
| Comp face value | Menu price of redeemed comps | `comp_face_value_usd`, `face_value_cents` |
| Comp economic cost | Cost of goods of redeemed comps — the real spend | `comp_cost_usd`, `economic_cost_cents` |

`player_period.tracked_net_usd` is from the **player's** perspective (payout − coin-in); casino net = −Σ `tracked_net_usd` = Σ coin-in − Σ payout.

## Overview KPIs (Jan 1 – Jun 30 2025)

| KPI | Value | Calculation |
| --- | ---: | --- |
| Tracked casino net | $15,585,460.60 | Σ tracked_coin_in_usd − Σ tracked_payout_usd (player_period) |
| Tracked wagering | $163,804,869.65 | Σ tracked_coin_in_usd |
| Tracked payouts | $148,219,409.05 | Σ tracked_payout_usd |
| Operations tickets | 1,226 | row count of operations (1,207 fault_repair, 10 install, 4 move, 3 scheduled_maintenance, 2 retire) |
| Total downtime | 5,021.08 h | Σ (available_at_utc − opened_at_utc), all tickets |
| Comp economic cost | $190,669.30 | Σ comp_cost_usd |
| Comp face value | $682,749.50 | Σ comp_face_value_usd |

## Q1 — machine performance

- Per machine (selected months): occupancy = Σ occupied_hours ÷ Σ available_hours; theo/hr = Σ theo_usd ÷ Σ available_hours; availability = Σ available_hours ÷ Σ scheduled hours on active days (`calendar_day.scheduled_seconds`).
- Percentile ranks (pandas `rank(pct=True)`, average ties) **within `config_id`**.
- Score = 0.60 × (1 − theo/hr percentile) + 0.40 × (1 − occupancy percentile).
- Eligibility: ≥ 90 on-floor days (scaled to half the window for shorter periods) and available hours > 0.
- **Discrepancy investigated:** the team script counted calendar rows (including days before install / after retirement) as "observed days", so every machine passed the 90-day rule. The dashboard counts on-floor days, which also excludes M-5076 (49 days) and M-1118 (55 days). The full-period top 10 is identical either way; the pipeline verifies the team's list exactly.
- Manager's list = 10 lowest Σ house_win_usd over active days (GUIDE.md starter query).

## Q2 — floor demand

- Zone × month over active machine-days: daily coin-in = Σ coin-in ÷ gaming days; occupancy; coin-in per available hour.
- Traffic: `zone_traffic_hourly` hours mapped to gaming days; `counter_status = offline` dropped; entries per counter-hour = Σ entries ÷ (Σ coverage_minutes ÷ 60).
- Change = last-month value ÷ first-month value − 1 for the selected period.
- Correlation: Pearson r of daily entries per counter-hour and daily coin-in, per zone, Jan–Jun. Our values (e.g. Back Forty 0.979) differ slightly from the team's `q2_zone_traffic_correlations.csv` (0.977) because we map hours to gaming days and exclude offline hours.
- Jan and Jun daily coin-in for all 7 zones match `analysis/q2_floor_demand/outputs/zone_demand_change.csv` (14 checks).
- Hour-of-day profile reuses the team's `q2_hourly_demand_by_zone.csv` (from `machine_hour`).

## Q3 — maintenance

- downtime = available_at − opened_at; response = work_started_at − opened_at; repair = available_at − work_started_at (UTC).
- Machine theo rate = Σ theo_usd ÷ Σ available_hours on `meter_status = reported` days.
- **Estimated lost exposure = fault-repair downtime hours × machine theo per available hour.** Not computed for planned tickets. Total: $88,346.72 (estimate, upper bound: assumes average play and no substitution).
- Verified: avg downtime 4.10 h and avg response 1.12 h (all tickets); M-1002 $1,557.63, M-1112 $1,391.24, M-1176 $1,271.80; M-1065 81.11 h.

## Q4 — player financials

- Player-level sums over the selected months (21 contiguous ranges precomputed).
- Loser: casino net > $0.005; winner: < −$0.005; otherwise break-even.
- Top-x% share: rank descending, k = ceil(n × x%), share = Σ top k ÷ Σ all. Loss shares use losing players only.
- Gini = 2 Σ i·x₍ᵢ₎ ÷ (n Σ x) − (n + 1) ÷ n on ascending values.
- Verified: 113,890 players; 80,992 / 15,504 / 17,394; gross losses $20,939,424.55; winnings $5,353,963.95; loss shares 15.73 / 40.73 / 52.84 / 66.52 %; wager shares 22.86 % (top 1 %), 55.34 % (top 5 %); Gini 0.7536.

## Q5 — loyalty

- Monthly cost and cost ÷ carded theo (player_period). Verified Jan–Jun: $28,750.30 (1.11 %), $29,854.30 (1.20 %), $33,255.50 (1.22 %), $31,390.30 (1.24 %), $34,446.10 (1.30 %), $32,972.80 (1.32 %).
- Reconciliation: player_period, property_day and loyalty_ledger all give $190,669.30 cost and $682,749.50 face.
- Points per face dollar = −Σ points_delta ÷ (Σ face_value_cents ÷ 100) over redeem events, by gaming day, tier and benefit. Falls from ~15.0/12.0/9.0 (Base/Gold/Platinum) to ~7.0/5.6/4.2 from May 1. Reported as an observed change; no policy record exists in the data.
- Tier transitions: ledger rows with tier_before ≠ tier_after (6,630: 5,253 Base→Gold, 1,377 Gold→Platinum).

## Forecast model

- Target: daily floor coin-in (property_day). Train Jan 1–Apr 30 (120 days); holdout May 1–Jun 30 (61 days); frozen Apr 30.
- Baselines: training mean; weekday average. Candidates: weekday average + AR(1) residual (recursive); OLS with weekday dummies, federal holiday, pre-announced event flag, linear trend.
- Leakage controls: no holdout actuals as inputs; only events with `announced_date` ≤ Apr 30 (excludes the Locals Appreciation Week, announced May 26); no later-published tourism data.
- Result: MAE $218,258 (mean), $68,699 (weekday), $68,624 (AR), $65,187 (regression). 7-day moving-block bootstrap 95 % CI of the regression's gain vs weekday: −$4,530 to $16,591 → not conclusive.

## Recommendation costs

`quantity × (unit_cost_cents + recurring_cost_cents_per_day × max(0, 30 − lead_days)) ÷ 100`

Q6 funds up to 3 action types (GUIDE.md §6); keeping money does not use a slot.

| Action | Qty | Unit cost | Cost | Lead days → days of effect | How it is judged |
| --- | ---: | ---: | ---: | --- | --- |
| A-TECH-SHIFT | 1 | $11,520 | $11,520 | 7 → 23 | Response time, repair duration and fault downtime vs the Jan–Jun baseline and unchanged shifts. On estimated exposure it cannot pay back within 30 days (response is 27.9 % of fault downtime, ≤ $4,089 per 30 days); it is a measured test. |
| A-INSPECT (the 10 Q1 candidates) | 10 | $1,200 | $12,000 | 1 → 29 | Faults and paytable issues found and corrected; later availability vs uninspected Back Forty machines. |
| A-COMP-PILOT | 1 | $4,000 | $4,000 | 5 → 25 | Incremental net revenue and repeat visits, treatment vs randomised control. |
| A-HOLD (preserved) | 1 | $0 | $72,480 kept | — | Released only when a test supports another investment. |
| **Total** | | | **$100,000** | | $27,520 invested + $72,480 preserved |

All recurring costs for these actions are $0. Effects are hypotheses to test; the catalogue provides prices and limits only.

## Data sources

Dashboard Royale release `0.9.0-draft`: `data/1_prepared_views`, `data/2_machine_decision`, `data/3_guests`, `data/4_context` (including real public LVCVA data in `real_sources`, used for context only), and `data/5_optional/machine_hour` via the team's Q2 hourly output.

## Final-pass analyses (pipeline/analytics.py, tested in pipeline/tests/)

### Q1 · Luck, location or leak
- **Payout test.** For each machine with play: observed hold = Σ house_win ÷ Σ coin_in; expected hold = Σ theo ÷ Σ coin_in (= 1 − configured RTP). Standard error = √(payout_multiplier_variance × bet-mix factor ÷ paid_spins), using `game_math`. The bet-mix factor E[b²]/E[b]² assumes an equal mix of the listed `bet_options_cents` (bet size per spin is not recorded); it widens the error, so the test is conservative. z = (observed − expected) ÷ SE.
- **Flag.** |z| at or beyond the Bonferroni-corrected two-sided 5% level across all tested machines ("payout anomaly lead"); z ≤ −2.58 uncorrected is "watch". Months below theo are compared with Binomial(n, 0.5) as a persistence check. A flag is a reason to inspect, not proof of a fault.
- **Zone-adjusted ranking.** theo/hr ÷ floor-wide median theo/hr of the machine's configuration, then percentiles within the zone; zone score = 0.6 (1 − pct theo ratio) + 0.4 (1 − pct occupancy). A config-ranked candidate is "machine-specific" if it is in the weakest 20% of its own zone, otherwise "location".

### Q2 · Walkway closure
- Closure dates come from `floor_walkways.closed_from_utc / closed_to_utc`, converted to gaming dates with `calendar_day`. Before / during / after windows have equal length in whole weeks, so the weekday mix is identical.
- Per zone and window: coin-in per day, theo per day, occupancy (ratio of sums), entries per counter-hour (offline hours excluded).
- Difference-in-differences = zone % change − rest-of-floor % change over the same windows, which nets out citywide events and season.

### Q6 · Scenarios and break-even
- Inspection benefit = Σ (theo − house win) per active day of the target machines × operating days; cost includes the inspection downtime valued at each machine's theo per available hour. Low = no fault; base = only flagged machines; high = all targets.
- Signage benefit = remaining gap after reopening (−DiD after × pre-closure theo/day) × recovery × operating days; low 0%, base 50%, high 100%.
- Comp pilot savings = (May–Jun − Jan–Apr monthly comp cost) × treatment share × operating days ÷ 30; the annual value of the pricing decision (monthly increase × 12) is reported separately and not counted in the horizon.
- Break-even = cost ÷ high-scenario benefit.

### Forecast decisions
- July 2025 is forecast with the regression frozen on April 30 (weekday, Jul 4 federal holiday, no pre-announced events, trend). Inspections use the lowest forecast days after their lead time.
- Floor-level detection limit ≈ holdout MAE ÷ √days ÷ mean daily coin-in; effects below it are measured at zone or machine level instead.
