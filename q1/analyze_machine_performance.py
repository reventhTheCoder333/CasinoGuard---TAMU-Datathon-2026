import pandas as pd
import numpy as np
from pathlib import Path

# --------------------------------------------------
# 1. Load data
# --------------------------------------------------
DATA = Path("data/1_prepared_views/prepared_daily_view.csv")
df = pd.read_csv(DATA)

df["gaming_date"] = pd.to_datetime(df["gaming_date"])

# Challenge period: January 1 - June 30, 2025
df = df[
    (df["gaming_date"] >= "2025-01-01") &
    (df["gaming_date"] <= "2025-06-30")
].copy()

numeric_cols = [
    "available_hours", "occupied_hours", "theo_usd",
    "house_win_usd", "luck_residual_usd",
    "contribution_after_supplied_costs_usd",
    "coin_in_usd", "faults_opened"
]

for col in numeric_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

df["active"] = df["active"].astype(str).str.lower().isin(
    ["true", "1", "yes"]
)

# --------------------------------------------------
# 2. Aggregate six months of machine performance
# --------------------------------------------------
machines = df.groupby("machine_id").agg(
    theme=("theme", "first"),
    config_id=("config_id", "first"),
    volatility_class=("volatility_class", "first"),
    manufacturer=("manufacturer", "first"),
    lease_class=("lease_class", "first"),

    active_days=("active", "sum"),
    observed_days=("gaming_date", "nunique"),

    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),

    theoretical_win=("theo_usd", "sum"),
    actual_house_win=("house_win_usd", "sum"),
    luck_residual=("luck_residual_usd", "sum"),

    coin_in=("coin_in_usd", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    faults=("faults_opened", "sum")
).reset_index()

# --------------------------------------------------
# 3. Normalize for machine exposure and availability
# --------------------------------------------------
machines["scheduled_hours"] = machines["active_days"] * 24

machines["availability_rate"] = np.where(
    machines["scheduled_hours"] > 0,
    machines["available_hours"] / machines["scheduled_hours"],
    np.nan
)

machines["occupancy_rate"] = np.where(
    machines["available_hours"] > 0,
    machines["occupied_hours"] / machines["available_hours"],
    np.nan
)

machines["theo_per_available_hour"] = np.where(
    machines["available_hours"] > 0,
    machines["theoretical_win"] / machines["available_hours"],
    np.nan
)

machines["actual_win_per_available_hour"] = np.where(
    machines["available_hours"] > 0,
    machines["actual_house_win"] / machines["available_hours"],
    np.nan
)

machines["contribution_per_available_hour"] = np.where(
    machines["available_hours"] > 0,
    machines["contribution"] / machines["available_hours"],
    np.nan
)

machines["luck_percentage_of_theo"] = np.where(
    machines["theoretical_win"] > 0,
    machines["luck_residual"] / machines["theoretical_win"],
    np.nan
)

# --------------------------------------------------
# 4. Compare machines against similar game configurations
# --------------------------------------------------
# Percentile 0 = near the bottom of its peer group.
# Percentile 1 = near the top of its peer group.

peer_group = machines.groupby("config_id", dropna=False)

machines["theo_performance_percentile"] = peer_group[
    "theo_per_available_hour"
].rank(pct=True)

machines["occupancy_percentile"] = peer_group[
    "occupancy_rate"
].rank(pct=True)

# Lower score means weaker normalized performance.
# Theoretical earning rate receives more weight than occupancy.
machines["underperformance_score"] = (
    0.60 * (1 - machines["theo_performance_percentile"]) +
    0.40 * (1 - machines["occupancy_percentile"])
)

# --------------------------------------------------
# 5. Basic eligibility and ranking
# --------------------------------------------------
# Require at least 90 observed days and positive availability.
eligible = machines[
    (machines["observed_days"] >= 90) &
    (machines["available_hours"] > 0) &
    machines["underperformance_score"].notna()
].copy()

eligible = eligible.sort_values(
    "underperformance_score",
    ascending=False
)

eligible["candidate_rank"] = range(1, len(eligible) + 1)

top10 = eligible.head(10)

# --------------------------------------------------
# 6. Save results
# --------------------------------------------------
machines.to_csv("machine_performance_all.csv", index=False)
eligible.to_csv("machine_performance_ranked.csv", index=False)
top10.to_csv("preliminary_bottom_10_machines.csv", index=False)

display_cols = [
    "candidate_rank",
    "machine_id",
    "theme",
    "config_id",
    "active_days",
    "availability_rate",
    "occupancy_rate",
    "theo_per_available_hour",
    "actual_win_per_available_hour",
    "luck_residual",
    "contribution_per_available_hour",
    "underperformance_score"
]

print("\n" + "=" * 90)
print("PRELIMINARY 10 UNDERPERFORMING MACHINES")
print("=" * 90)
print(top10[display_cols].to_string(index=False))

print("\nTOTAL MACHINES:", len(machines))
print("ELIGIBLE MACHINES:", len(eligible))
print("MACHINES WITH INSUFFICIENT DATA:", len(machines) - len(eligible))

print("\nSaved:")
print("- machine_performance_all.csv")
print("- machine_performance_ranked.csv")
print("- preliminary_bottom_10_machines.csv")

print("\nIMPORTANT:")
print("This is a preliminary peer-relative ranking, not the final")
print("replacement decision. Statistical uncertainty and luck")
print("adjustments still need to be tested.")
