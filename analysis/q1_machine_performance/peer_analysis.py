import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

df = pd.read_csv(
    "data/1_prepared_views/prepared_daily_view.csv"
)

df = df[df["meter_status"] == "reported"].copy()

# One row per machine
machines = df.groupby("machine_id").agg(
    config_id=("config_id", "first"),
    theme=("theme", "first"),
    volatility=("volatility_class", "first"),
    manufacturer=("manufacturer", "first"),
    zone=("zone_name", "first"),
    days=("gaming_date", "nunique"),
    theo=("theo_usd", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    faults=("faults_opened", "sum"),
    luck=("luck_residual_usd", "sum")
).reset_index()

machines["theo_per_hour"] = (
    machines["theo"] / machines["available_hours"]
)

machines["contribution_per_hour"] = (
    machines["contribution"] / machines["available_hours"]
)

machines["occupancy"] = (
    machines["occupied_hours"] / machines["available_hours"]
)

machines["faults_per_1000_hours"] = (
    machines["faults"] / machines["available_hours"] * 1000
)

# Compare each machine with the median of its own game configuration
peer_metrics = [
    "theo_per_hour",
    "contribution_per_hour",
    "occupancy",
    "faults_per_1000_hours"
]

for metric in peer_metrics:
    peer_median = machines.groupby("config_id")[metric].transform("median")

    machines[f"{metric}_vs_peer"] = (
        machines[metric] / peer_median
    )

    machines[f"{metric}_percentile"] = (
        machines.groupby("config_id")[metric]
        .rank(pct=True) * 100
    )

# Lower values indicate weaker performance for these metrics.
# For faults, higher values indicate worse reliability.
machines["performance_flag"] = (
    (machines["theo_per_hour_percentile"] <= 25) &
    (machines["contribution_per_hour_percentile"] <= 25)
)

machines["reliability_flag"] = (
    machines["faults_per_1000_hours_percentile"] >= 75
)

machines["limited_history"] = machines["days"] < 120

# Show the weakest machines within their own game configurations
columns = [
    "machine_id",
    "config_id",
    "days",
    "theo_per_hour",
    "theo_per_hour_vs_peer",
    "contribution_per_hour",
    "contribution_per_hour_vs_peer",
    "occupancy",
    "occupancy_vs_peer",
    "faults_per_1000_hours",
    "performance_flag",
    "reliability_flag",
    "limited_history"
]

print("\nMOST CONCERNING MACHINES")
print(
    machines.sort_values(
        ["performance_flag", "contribution_per_hour_percentile"]
    )[columns].head(25).round(3).to_string(index=False)
)

print("\nMACHINES FLAGGED FOR WEAK PERFORMANCE")
print(
    machines[machines["performance_flag"]]
    [columns].round(3).to_string(index=False)
)

print("\nMACHINE COUNTS BY CONFIGURATION")
print(
    machines.groupby("config_id").size()
    .sort_values(ascending=False).to_string()
)

print("\nFLAG SUMMARY")
print("Weak performance:", machines["performance_flag"].sum())
print("Reliability concerns:", machines["reliability_flag"].sum())
print("Limited history:", machines["limited_history"].sum())

print("\nTOP 20 REPLACEMENT CANDIDATES - INITIAL SCREEN")

candidates = machines[
    machines["performance_flag"] &
    ~machines["limited_history"]
].copy()

candidates = candidates.sort_values(
    ["contribution_per_hour_percentile",
     "theo_per_hour_percentile"],
    ascending=True
)

print(
    candidates[[
        "machine_id",
        "config_id",
        "days",
        "theo_per_hour",
        "theo_per_hour_vs_peer",
        "contribution_per_hour",
        "contribution_per_hour_vs_peer",
        "occupancy",
        "faults_per_1000_hours",
        "reliability_flag"
    ]].head(20).round(3).to_string(index=False)
)
