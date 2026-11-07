import pandas as pd
import numpy as np
from pathlib import Path

BASE = Path("data")

# Load prepared daily data
df = pd.read_csv(BASE / "1_prepared_views/prepared_daily_view.csv")
df["gaming_date"] = pd.to_datetime(df["gaming_date"])

df = df[
    (df["gaming_date"] >= "2025-01-01") &
    (df["gaming_date"] <= "2025-06-30")
].copy()

numeric = [
    "available_hours", "occupied_hours", "theo_usd",
    "house_win_usd", "luck_residual_usd",
    "repair_cost_usd", "faults_opened",
    "zone_entries_observed", "zone_counter_coverage_hours"
]

for col in numeric:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

# Identify active machine-days
df["active"] = df["active"].astype(str).str.lower().isin(
    ["true", "1", "yes"]
)

# Aggregate machine performance
machines = df.groupby("machine_id").agg(
    theme=("theme", "first"),
    config_id=("config_id", lambda x: x.mode().iloc[0] if not x.mode().empty else "UNKNOWN"),
    manufacturer=("manufacturer", "first"),
    lease_class=("lease_class", "first"),
    active_days=("active", "sum"),
    observed_days=("gaming_date", "nunique"),
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    theoretical_win=("theo_usd", "sum"),
    actual_house_win=("house_win_usd", "sum"),
    luck_residual=("luck_residual_usd", "sum"),
    repair_cost=("repair_cost_usd", "sum"),
    faults=("faults_opened", "sum")
).reset_index()

machines["availability_rate"] = (
    machines["available_hours"] /
    (machines["active_days"] * 24).replace(0, np.nan)
)

machines["occupancy_rate"] = (
    machines["occupied_hours"] /
    machines["available_hours"].replace(0, np.nan)
)

machines["theo_per_available_hour"] = (
    machines["theoretical_win"] /
    machines["available_hours"].replace(0, np.nan)
)

machines["actual_win_per_available_hour"] = (
    machines["actual_house_win"] /
    machines["available_hours"].replace(0, np.nan)
)

machines["contribution_luck_residual"] = machines["luck_residual"]

# Get the dominant floor location for each machine
location = (
    df.groupby(["machine_id", "zone_id", "zone_name", "location_id"])
    .size()
    .reset_index(name="days_in_location")
    .sort_values("days_in_location", ascending=False)
    .drop_duplicates("machine_id")
)

machines = machines.merge(
    location[["machine_id", "zone_id", "zone_name", "location_id"]],
    on="machine_id",
    how="left"
)

# Estimate zone traffic without double-counting machines
traffic_available = (
    "zone_entries_observed" in df.columns
    and "zone_counter_coverage_hours" in df.columns
)

if traffic_available:
    zone_daily = (
        df.drop_duplicates(["gaming_date", "zone_id"])
        .groupby("zone_id")
        .agg(
            zone_entries=("zone_entries_observed", "sum"),
            coverage_hours=("zone_counter_coverage_hours", "sum")
        )
        .reset_index()
    )

    zone_daily["zone_entries_per_coverage_hour"] = (
        zone_daily["zone_entries"] /
        zone_daily["coverage_hours"].replace(0, np.nan)
    )

    machines = machines.merge(
        zone_daily[["zone_id", "zone_entries_per_coverage_hour"]],
        on="zone_id",
        how="left"
    )

# Compare machines within the same configuration
machines["theo_percentile"] = (
    machines.groupby("config_id")["theo_per_available_hour"]
    .rank(pct=True)
)

machines["occupancy_percentile"] = (
    machines.groupby("config_id")["occupancy_rate"]
    .rank(pct=True)
)

machines["underperformance_score"] = (
    0.60 * (1 - machines["theo_percentile"]) +
    0.40 * (1 - machines["occupancy_percentile"])
)

# Require meaningful observation history
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

# Final 10 candidates
top10 = eligible.head(10).copy()

# Add concise evidence labels
top10["availability_assessment"] = np.where(
    top10["availability_rate"] >= 0.95,
    "High availability",
    "Availability may be affecting performance"
)

top10["luck_assessment"] = np.select(
    [
        top10["luck_residual"] > 0,
        top10["luck_residual"] < 0
    ],
    [
        "Actual win above theoretical",
        "Actual win below theoretical"
    ],
    default="Near theoretical"
)

# Save outputs
machines.to_csv("final_machine_performance_all.csv", index=False)
eligible.to_csv("final_machine_ranking.csv", index=False)
top10.to_csv("FINAL_BOTTOM_10_CANDIDATES.csv", index=False)

# Check machine registry
registry_path = BASE / "2_machine_decision/machines.csv"

if registry_path.exists():
    registry = pd.read_csv(registry_path)
    print("\nMACHINE REGISTRY CHECK")
    print("Unique registry machines:", registry["machine_id"].nunique())
    print("Machines in prepared data:", df["machine_id"].nunique())

    if "retire_date" in registry.columns:
        print("Registry machines with no retirement date:",
              registry["retire_date"].isna().sum())

# Print results
columns = [
    "candidate_rank",
    "machine_id",
    "theme",
    "config_id",
    "zone_name",
    "location_id",
    "availability_rate",
    "occupancy_rate",
    "theo_per_available_hour",
    "actual_win_per_available_hour",
    "luck_residual",
    "repair_cost",
    "faults",
    "underperformance_score"
]

print("\n" + "=" * 110)
print("CASINOGUARD — FINAL 10 REPLACEMENT CANDIDATES")
print("=" * 110)

print(top10[columns].to_string(
    index=False,
    float_format=lambda x: f"{x:.3f}"
))

print("\nTOTAL MACHINES:", len(machines))
print("ELIGIBLE MACHINES:", len(eligible))
print("FINAL CANDIDATES:", len(top10))

if traffic_available:
    print("\nFloor traffic context included.")
else:
    print("\nFloor traffic fields unavailable; location context only.")

print("\nSaved:")
print("- final_machine_performance_all.csv")
print("- final_machine_ranking.csv")
print("- FINAL_BOTTOM_10_CANDIDATES.csv")

print("\nDecision note:")
print("These are evidence-backed replacement candidates,")
print("not proof that replacement is better than relocation or repair.")
