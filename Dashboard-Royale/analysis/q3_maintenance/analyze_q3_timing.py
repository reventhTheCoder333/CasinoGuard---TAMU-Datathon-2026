import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

BASE = "data/2_machine_decision/"

# Load source data
ops = pd.read_csv(BASE + "operations.csv")
daily = pd.read_csv(BASE + "machine_day.csv")
calendar = pd.read_csv(BASE + "calendar_day.csv")

# Parse timestamps
for col in [
    "opened_at_utc",
    "work_started_at_utc",
    "available_at_utc",
]:
    ops[col] = pd.to_datetime(ops[col], errors="coerce")

ops["opened_at_local"] = pd.to_datetime(
    ops["opened_at_local"], errors="coerce"
)

calendar["gaming_day_start_utc"] = pd.to_datetime(
    calendar["gaming_day_start_utc"]
)
calendar["gaming_day_end_utc"] = pd.to_datetime(
    calendar["gaming_day_end_utc"]
)

daily["theo_rate_cents_per_second"] = (
    daily["theo_cents"] / daily["available_seconds"].replace(0, pd.NA)
)

# Calculate repair timing
ops["downtime_hours"] = (
    ops["available_at_utc"] - ops["opened_at_utc"]
).dt.total_seconds() / 3600

ops["response_hours"] = (
    ops["work_started_at_utc"] - ops["opened_at_utc"]
).dt.total_seconds() / 3600

ops["repair_hours"] = (
    ops["available_at_utc"] - ops["work_started_at_utc"]
).dt.total_seconds() / 3600

ops["opened_hour"] = ops["opened_at_local"].dt.hour
ops["opened_weekday"] = ops["opened_at_local"].dt.day_name()
ops["opened_date"] = ops["opened_at_local"].dt.date

# Match each repair interval to the gaming dates it overlaps.
# Estimate exposure using that machine's daily theo rate
# per available second.

daily_lookup = daily.set_index(
    ["machine_id", "gaming_date"]
)

overlaps = []

for _, op in ops.iterrows():
    start = op["opened_at_utc"]
    end = op["available_at_utc"]

    if pd.isna(start) or pd.isna(end) or end <= start:
        continue

    for _, day in calendar.iterrows():
        overlap_start = max(start, day["gaming_day_start_utc"])
        overlap_end = min(end, day["gaming_day_end_utc"])

        seconds = (overlap_end - overlap_start).total_seconds()

        if seconds <= 0:
            continue

        key = (op["machine_id"], day["gaming_date"])

        if key not in daily_lookup.index:
            continue

        machine_day = daily_lookup.loc[key]

        if isinstance(machine_day, pd.DataFrame):
            machine_day = machine_day.iloc[0]

        rate = machine_day["theo_rate_cents_per_second"]

        exposure = (
            seconds * rate
            if pd.notna(rate)
            else 0
        )

        overlaps.append({
            "operation_id": op["operation_id"],
            "machine_id": op["machine_id"],
            "gaming_date": day["gaming_date"],
            "weekday": day["local_weekday"],
            "is_weekend": day["is_weekend"],
            "hour": op["opened_hour"],
            "downtime_hours": seconds / 3600,
            "estimated_exposure_dollars": exposure / 100,
        })

impact = pd.DataFrame(overlaps)

# Overall results
print("\n========== OVERALL Q3 RESULTS ==========")
print("Repair events:", len(ops))
print("Total downtime hours:", round(ops["downtime_hours"].sum(), 2))
print("Average downtime per event:", round(ops["downtime_hours"].mean(), 2))
print("Average response time:", round(ops["response_hours"].mean(), 2))
print("Average repair duration:", round(ops["repair_hours"].mean(), 2))

print(
    "Estimated theoretical play exposure: $",
    round(impact["estimated_exposure_dollars"].sum(), 2)
)

# When do faults occur?
print("\n========== DOWNTIME BY HOUR FAULT OPENED ==========")
print(
    ops.groupby("opened_hour")["downtime_hours"]
    .agg(["count", "sum", "mean"])
    .round(2)
    .to_string()
)

print("\n========== DOWNTIME BY WEEKDAY FAULT OPENED ==========")
print(
    ops.groupby("opened_weekday")["downtime_hours"]
    .agg(["count", "sum", "mean"])
    .round(2)
    .to_string()
)

# When does the financial exposure occur?
print("\n========== EXPOSURE BY HOUR ==========")
print(
    impact.groupby("hour")["estimated_exposure_dollars"]
    .sum()
    .sort_values(ascending=False)
    .round(2)
    .to_string()
)

print("\n========== EXPOSURE BY WEEKDAY ==========")
print(
    impact.groupby("weekday")["estimated_exposure_dollars"]
    .sum()
    .sort_values(ascending=False)
    .round(2)
    .to_string()
)

print("\n========== WEEKDAY VS WEEKEND ==========")
print(
    impact.groupby("is_weekend")[
        ["downtime_hours", "estimated_exposure_dollars"]
    ].sum().round(2).to_string()
)

# Most financially affected machines
print("\n========== TOP 10 MACHINES BY ESTIMATED EXPOSURE ==========")
print(
    impact.groupby("machine_id")[
        ["downtime_hours", "estimated_exposure_dollars"]
    ]
    .sum()
    .sort_values("estimated_exposure_dollars", ascending=False)
    .head(10)
    .round(2)
    .to_string()
)

# Export detailed results
ops.to_csv("analysis/q3_maintenance/outputs/q3_operation_timing.csv", index=False)
impact.to_csv("analysis/q3_maintenance/outputs/q3_downtime_by_gaming_day.csv", index=False)

print("\nSaved:")
print("analysis/q3_maintenance/outputs/q3_operation_timing.csv")
print("analysis/q3_maintenance/outputs/q3_downtime_by_gaming_day.csv")
