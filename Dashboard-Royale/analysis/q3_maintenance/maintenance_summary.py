import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

df = pd.read_csv("analysis/q3_maintenance/outputs/maintenance_analysis.csv")

# ==========================================
# Q3: HOW MUCH PLAY WAS LOST TO DOWNTIME, AND WHEN?
# ==========================================

# 1. Overall downtime analysis

total_downtime = df["total_downtime_hours"].sum()

total_exposure = df[
    "estimated_theo_exposure_during_downtime"
].sum()

total_machines = df["machine_id"].nunique()

total_repairs = df["repair_events"].sum()

print("\n========== OVERALL DOWNTIME IMPACT ==========")
print("Machines analyzed:", total_machines)
print("Total repair events:", total_repairs)
print("Total downtime:", round(total_downtime, 2), "hours")
print("Estimated theoretical play exposure: $",
      round(total_exposure, 2))
print("Average downtime per machine:",
      round(df["total_downtime_hours"].mean(), 2), "hours")

# 2. Top machines by lost-play exposure

print("\n========== TOP 10 MACHINES BY LOST PLAY ==========")

top_exposure = df.sort_values(
    "estimated_theo_exposure_during_downtime",
    ascending=False
)

print(
    top_exposure[
        [
            "machine_id",
            "manufacturer",
            "theme",
            "total_downtime_hours",
            "theo_per_hour",
            "estimated_theo_exposure_during_downtime"
        ]
    ].head(10).to_string(index=False)
)

# 3. Top machines by downtime

print("\n========== TOP 10 MACHINES BY DOWNTIME ==========")

print(
    df.nlargest(10, "total_downtime_hours")[
        [
            "machine_id",
            "total_downtime_hours",
            "repair_events",
            "avg_downtime_hours"
        ]
    ].to_string(index=False)
)

# 4. Manufacturer analysis

print("\n========== DOWNTIME BY MANUFACTURER ==========")

manufacturer = df.groupby("manufacturer").agg(
    machines=("machine_id", "nunique"),
    downtime=("total_downtime_hours", "sum"),
    estimated_exposure=(
        "estimated_theo_exposure_during_downtime", "sum"
    )
).sort_values("estimated_exposure", ascending=False)

print(manufacturer.round(2))

# 5. Machine age analysis

print("\n========== MACHINE AGE VS DOWNTIME ==========")

print(
    df.groupby(
        pd.cut(df["machine_age_years"], bins=5)
    ).agg(
        machines=("machine_id", "count"),
        downtime=("total_downtime_hours", "mean"),
        exposure=(
            "estimated_theo_exposure_during_downtime", "mean"
        )
    ).round(2)
)

# 6. Repair frequency and response time

print("\n========== REPAIR PERFORMANCE ==========")

print("Average repair events per machine:",
      round(df["repair_events"].mean(), 2))

print("Average downtime per repair event:",
      round(
          df["total_downtime_hours"].sum() /
          df["repair_events"].sum(), 2
      ))

print("Average technician response time:",
      round(df["avg_response_hours"].mean(), 2), "hours")

print("\n========== Q3 COMPLETE ==========")
