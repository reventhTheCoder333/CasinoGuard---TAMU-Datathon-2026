import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

# --------------------------------------------------
# LOAD DATA
# --------------------------------------------------

ops = pd.read_csv("data/2_machine_decision/operations.csv")
machine_info = pd.read_csv("data/2_machine_decision/machines.csv")
daily = pd.read_csv("data/1_prepared_views/prepared_daily_view.csv")

# Parse timestamps
time_cols = [
    "opened_at_utc",
    "work_started_at_utc",
    "available_at_utc"
]

for col in time_cols:
    ops[col] = pd.to_datetime(ops[col], utc=True)

# --------------------------------------------------
# FILTER REPAIR EVENTS
# --------------------------------------------------

repairs = ops[ops["event_type"] == "fault_repair"].copy()

# Calculate downtime and response time
repairs["downtime_hours"] = (
    repairs["available_at_utc"] -
    repairs["opened_at_utc"]
).dt.total_seconds() / 3600

repairs["response_hours"] = (
    repairs["work_started_at_utc"] -
    repairs["opened_at_utc"]
).dt.total_seconds() / 3600

# Check for invalid durations
print("\nINVALID DURATIONS")
print("Negative downtime:", (repairs["downtime_hours"] < 0).sum())
print("Negative response:", (repairs["response_hours"] < 0).sum())

# Keep valid repair durations
repairs = repairs[
    (repairs["downtime_hours"] >= 0) &
    (repairs["response_hours"] >= 0)
].copy()

repairs["repair_cost_usd"] = (
    repairs["direct_cost_cents"] / 100
)

# --------------------------------------------------
# MACHINE-LEVEL MAINTENANCE SUMMARY
# --------------------------------------------------

maintenance = repairs.groupby("machine_id").agg(
    repair_events=("operation_id", "count"),
    total_downtime_hours=("downtime_hours", "sum"),
    avg_downtime_hours=("downtime_hours", "mean"),
    avg_response_hours=("response_hours", "mean"),
    total_repair_cost=("repair_cost_usd", "sum")
).reset_index()

# --------------------------------------------------
# MACHINE PERFORMANCE SUMMARY
# --------------------------------------------------

daily = daily[
    daily["meter_status"] == "reported"
].copy()

performance = daily.groupby("machine_id").agg(
    days=("gaming_date", "nunique"),
    theo=("theo_usd", "sum"),
    available_hours=("available_hours", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    faults_recorded=("faults_opened", "sum")
).reset_index()

performance["theo_per_hour"] = (
    performance["theo"] /
    performance["available_hours"]
)

performance["contribution_per_hour"] = (
    performance["contribution"] /
    performance["available_hours"]
)

# --------------------------------------------------
# COMBINE DATA
# --------------------------------------------------

result = (
    machine_info
    .merge(performance, on="machine_id", how="left")
    .merge(maintenance, on="machine_id", how="left")
)

# Machines with no repair records receive zero counts/costs
numeric_cols = [
    "repair_events",
    "total_downtime_hours",
    "avg_downtime_hours",
    "avg_response_hours",
    "total_repair_cost"
]

result[numeric_cols] = result[numeric_cols].fillna(0)

# Estimate theoretical win associated with downtime
result["estimated_theo_exposure_during_downtime"] = (
    result["total_downtime_hours"] *
    result["theo_per_hour"]
)

# Machine age as of June 30, 2025
result["install_date"] = pd.to_datetime(result["install_date"])

result["machine_age_years"] = (
    (pd.Timestamp("2025-06-30") - result["install_date"])
    .dt.days / 365.25
)

# --------------------------------------------------
# REPORTS
# --------------------------------------------------

print("\nOVERALL MAINTENANCE SUMMARY")

print("Repair events:", len(repairs))
print("Total repair downtime:",
      round(repairs["downtime_hours"].sum(), 2), "hours")

print("Total direct repair cost:",
      round(repairs["repair_cost_usd"].sum(), 2))

print("Average repair duration:",
      round(repairs["downtime_hours"].mean(), 2), "hours")

print("Average technician response time:",
      round(repairs["response_hours"].mean(), 2), "hours")

print("\nTOP 20 MACHINES BY TOTAL DOWNTIME")

print(
    result.sort_values(
        "total_downtime_hours",
        ascending=False
    )[[
        "machine_id",
        "manufacturer",
        "theme",
        "lease_class",
        "repair_events",
        "total_downtime_hours",
        "avg_downtime_hours",
        "total_repair_cost",
        "theo_per_hour",
        "estimated_theo_exposure_during_downtime"
    ]].head(20).round(2).to_string(index=False)
)

print("\nTOP 20 MACHINES BY REPAIR COST")

print(
    result.sort_values(
        "total_repair_cost",
        ascending=False
    )[[
        "machine_id",
        "manufacturer",
        "repair_events",
        "total_repair_cost",
        "total_downtime_hours",
        "machine_age_years",
        "lease_class"
    ]].head(20).round(2).to_string(index=False)
)

# --------------------------------------------------
# FOCUS ON OUR PREVIOUS CANDIDATES
# --------------------------------------------------

candidate_ids = [
    "M-1014",
    "M-1158",
    "M-1042",
    "M-1230",
    "M-1053",
    "M-1181",
    "M-1120",
    "M-1184",
    "M-1238",
    "M-1245"
]

print("\nPREVIOUSLY FLAGGED MACHINES: MAINTENANCE CHECK")

print(
    result[result["machine_id"].isin(candidate_ids)][[
        "machine_id",
        "manufacturer",
        "theme",
        "lease_class",
        "machine_age_years",
        "repair_events",
        "total_downtime_hours",
        "avg_downtime_hours",
        "avg_response_hours",
        "total_repair_cost",
        "theo_per_hour",
        "contribution_per_hour",
        "estimated_theo_exposure_during_downtime"
    ]].sort_values(
        "total_repair_cost",
        ascending=False
    ).round(2).to_string(index=False)
)

# Save results for future analyses
result.to_csv("analysis/q3_maintenance/outputs/maintenance_analysis.csv", index=False)

print("\nSaved: maintenance_analysis.csv")
