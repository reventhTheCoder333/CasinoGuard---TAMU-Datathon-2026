# Exploratory analyses

The team's original Python analyses, grouped by question. Each script can be run from any directory — it switches to the repository root first — and writes its results into its own folder's `outputs/`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pandas numpy matplotlib
```

Most scripts read the plain `.csv` tables. The repository stores them compressed, so unzip them once from the repository root:

```bash
find data -name "*.csv.gz" -exec gunzip -k {} \;
```

(The dashboard pipeline in `casinoguard/pipeline/` reads the `.csv.gz` files directly and does not need this step.)

## Scripts and outputs

| Folder | Script | Produces |
| --- | --- | --- |
| `q1_machine_performance` | `analyze_machines.py`, `inspect_machine_groups.py`, `peer_analysis.py`, `analyze_floor_demand.py` | Printed exploration (machine groups, peer comparison, zone context) |
| | `analyze_machine_performance.py` | `outputs/machine_performance_all.csv`, `machine_performance_ranked.csv`, `preliminary_bottom_10_machines.csv` |
| | `finalize_bottom_10.py` | `outputs/final_machine_performance_all.csv`, `final_machine_ranking.csv`, `FINAL_BOTTOM_10_CANDIDATES.csv` |
| `q2_floor_demand` | `q2_demand_analysis.py` | `outputs/` monthly, zone, theme and Back Forty demand CSVs and charts (needs the Q1 candidates file) |
| | `q2_traffic_analysis.py` | `outputs/` traffic-vs-demand CSVs, correlations and charts |
| | `q2_time_analysis.py` | `outputs/` hourly and weekday/weekend demand CSVs (uses `data/5_optional/machine_hour`) |
| `q3_maintenance` | `inspect_operations.py`, `inspect_q3_data.py` | Printed exploration |
| | `analyze_maintenance.py` | `outputs/maintenance_analysis.csv` |
| | `maintenance_summary.py` | Printed downtime and exposure summary (reads `maintenance_analysis.csv`) |
| | `analyze_q3_timing.py` | `outputs/q3_operation_timing.csv`, `q3_downtime_by_gaming_day.csv` |
| `q4_player_financials` | `q4_player_aggregation.py` (run first) | `outputs/q4_player_level_results.csv` |
| | `q4_financial_summary.py`, `q4_wager_concentration.py`, `q4_net_concentration.py`, `q4_exposure_analysis.py` | Printed results plus `outputs/q4_wagering_ranked.csv`, `q4_largest_player_losses.csv`, `q4_player_exposure_analysis.csv` |
| `q5_loyalty` | `q5_analysis.py` | Printed comp cost, ledger activity and tier transitions |
| `exploration` | `data_overview.py`, `inspect_data.py`, `inspect_floor.py` | Printed table overviews |

Run order where outputs feed later scripts: Q1 `finalize_bottom_10.py` → Q2 `q2_demand_analysis.py`; Q3 `analyze_maintenance.py` → `maintenance_summary.py`; Q4 `q4_player_aggregation.py` → the other Q4 scripts.

The dashboard pipeline (`casinoguard/pipeline/build_data.py`) recomputes and asserts these scripts' headline results, and reuses two Q2 outputs (`zone_demand_change.csv`, `q2_hourly_demand_by_zone.csv`).
