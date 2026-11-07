import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(".")
OUT = ROOT / "analysis/q2_floor_demand/outputs"
OUT.mkdir(exist_ok=True)

DAILY_FILE = ROOT / "data/1_prepared_views/prepared_daily_view.csv"
TRAFFIC_FILE = ROOT / "data/4_context/zone_traffic_hourly.csv.gz"

START = "2025-01-01"
END = "2025-06-30"

# Casino gaming days begin at 6:00 AM local time.
GAMING_DAY_START_HOUR = 6


# ============================================================
# 1. LOAD DATA
# ============================================================

print("Loading machine and traffic data...")

machines = pd.read_csv(DAILY_FILE)
traffic = pd.read_csv(TRAFFIC_FILE)

machines["gaming_date"] = pd.to_datetime(machines["gaming_date"])

traffic["hour_start_local"] = pd.to_datetime(
    traffic["hour_start_local"]
)

print(f"Machine-day records: {len(machines):,}")
print(f"Hourly traffic records: {len(traffic):,}")

# Filter machine data to the analysis period.
machines = machines[
    machines["gaming_date"].between(START, END)
].copy()

# Derive gaming date from local hourly timestamps.
# Hours before 6 AM belong to the previous gaming day.
traffic["gaming_date"] = (
    traffic["hour_start_local"]
    - pd.Timedelta(hours=GAMING_DAY_START_HOUR)
).dt.normalize()

traffic = traffic[
    traffic["gaming_date"].between(START, END)
].copy()

# Derive month using gaming date.
machines["month"] = (
    machines["gaming_date"].dt.to_period("M").astype(str)
)

traffic["month"] = (
    traffic["gaming_date"].dt.to_period("M").astype(str)
)


# ============================================================
# 2. AGGREGATE MACHINE DEMAND BY ZONE AND GAMING DAY
# ============================================================

print("\nAggregating machine demand...")

daily_zone = (
    machines.groupby(
        ["gaming_date", "zone_id", "zone_name"],
        as_index=False
    )
    .agg(
        coin_in=("coin_in_usd", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
        paid_spins=("paid_spins", "sum"),
        active_machines=("active", "sum"),
    )
)

daily_zone["coin_in_per_available_hour"] = (
    daily_zone["coin_in"]
    / daily_zone["available_hours"].replace(0, pd.NA)
)

daily_zone["occupancy_rate"] = (
    daily_zone["occupied_hours"]
    / daily_zone["available_hours"].replace(0, pd.NA)
)


# ============================================================
# 3. CLEAN AND AGGREGATE HOURLY FOOT TRAFFIC
# ============================================================

print("\nCleaning hourly traffic data...")

# Keep observations with actual sensor coverage.
traffic["coverage_minutes"] = pd.to_numeric(
    traffic["coverage_minutes"], errors="coerce"
)

traffic["entries_count"] = pd.to_numeric(
    traffic["entries_count"], errors="coerce"
)

traffic = traffic[
    (traffic["coverage_minutes"] > 0)
    & traffic["entries_count"].notna()
].copy()

# Display sensor statuses so we can inspect data quality.
print("\nTraffic counter statuses:")
print(traffic["counter_status"].value_counts(dropna=False))

# Aggregate traffic by zone and gaming day.
daily_traffic = (
    traffic.groupby(
        ["gaming_date", "zone_id"],
        as_index=False
    )
    .agg(
        entries=("entries_count", "sum"),
        coverage_minutes=("coverage_minutes", "sum"),
        sensor_hours=("coverage_minutes", lambda x: x.sum() / 60),
        traffic_records=("entries_count", "count"),
    )
)

# Normalize traffic by the actual hours the sensors were operating.
daily_traffic["entries_per_coverage_hour"] = (
    daily_traffic["entries"]
    / daily_traffic["sensor_hours"].replace(0, pd.NA)
)


# ============================================================
# 4. MERGE MACHINE DEMAND WITH FOOT TRAFFIC
# ============================================================

print("\nCombining traffic and machine demand...")

combined = daily_zone.merge(
    daily_traffic,
    on=["gaming_date", "zone_id"],
    how="inner"
)

combined["month"] = (
    combined["gaming_date"].dt.to_period("M").astype(str)
)

combined["coin_in_per_traffic_entry"] = (
    combined["coin_in"]
    / combined["entries"].replace(0, pd.NA)
)

combined.to_csv(
    OUT / "q2_daily_traffic_vs_demand.csv",
    index=False
)


# ============================================================
# 5. MONTHLY ZONE COMPARISON
# ============================================================

print("\nCalculating monthly zone comparisons...")

monthly = (
    combined.groupby(
        ["month", "zone_id", "zone_name"],
        as_index=False
    )
    .agg(
        total_coin_in=("coin_in", "sum"),
        total_entries=("entries", "sum"),
        total_occupied_hours=("occupied_hours", "sum"),
        total_available_hours=("available_hours", "sum"),
        total_sensor_hours=("sensor_hours", "sum"),
        total_spins=("paid_spins", "sum"),
        days_observed=("gaming_date", "nunique"),
    )
)

monthly["entries_per_coverage_hour"] = (
    monthly["total_entries"]
    / monthly["total_sensor_hours"].replace(0, pd.NA)
)

monthly["coin_in_per_available_hour"] = (
    monthly["total_coin_in"]
    / monthly["total_available_hours"].replace(0, pd.NA)
)

monthly["occupancy_rate"] = (
    monthly["total_occupied_hours"]
    / monthly["total_available_hours"].replace(0, pd.NA)
)

monthly["daily_coin_in"] = (
    monthly["total_coin_in"]
    / monthly["days_observed"]
)

monthly.to_csv(
    OUT / "q2_monthly_traffic_vs_demand.csv",
    index=False
)


# ============================================================
# 6. JANUARY VS JUNE COMPARISON
# ============================================================

print("\nComparing January and June...")

jan_june = monthly[
    monthly["month"].isin(["2025-01", "2025-06"])
].copy()

comparison = jan_june.pivot(
    index=["zone_id", "zone_name"],
    columns="month",
    values=[
        "daily_coin_in",
        "entries_per_coverage_hour",
        "coin_in_per_available_hour",
        "occupancy_rate",
    ]
)

comparison.columns = [
    f"{metric}_{month}"
    for metric, month in comparison.columns
]

comparison = comparison.reset_index()

for metric in [
    "daily_coin_in",
    "entries_per_coverage_hour",
    "coin_in_per_available_hour",
    "occupancy_rate",
]:
    jan_col = f"{metric}_2025-01"
    june_col = f"{metric}_2025-06"

    comparison[f"{metric}_change_pct"] = (
        (comparison[june_col] - comparison[jan_col])
        / comparison[jan_col].replace(0, pd.NA)
        * 100
    )

comparison.to_csv(
    OUT / "q2_zone_traffic_jan_june_comparison.csv",
    index=False
)


# ============================================================
# 7. DAILY TRAFFIC-DEMAND CORRELATION BY ZONE
# ============================================================

print("\nCalculating daily correlations...")

correlations = []

for (zone_id, zone_name), group in combined.groupby(
    ["zone_id", "zone_name"]
):
    valid = group[
        [
            "entries_per_coverage_hour",
            "coin_in_per_available_hour",
        ]
    ].dropna()

    correlation = (
        valid["entries_per_coverage_hour"].corr(
            valid["coin_in_per_available_hour"]
        )
        if len(valid) >= 3
        else pd.NA
    )

    correlations.append({
        "zone_id": zone_id,
        "zone_name": zone_name,
        "daily_observations": len(valid),
        "traffic_demand_correlation": correlation,
    })

correlations = pd.DataFrame(correlations)

correlations.to_csv(
    OUT / "q2_zone_traffic_correlations.csv",
    index=False
)


# ============================================================
# 8. BACK FORTY FOCUSED ANALYSIS
# ============================================================

print("\nAnalyzing Back Forty...")

back_forty = monthly[
    monthly["zone_name"].str.lower() == "back forty"
].copy()

back_forty.to_csv(
    OUT / "q2_back_forty_traffic_analysis.csv",
    index=False
)


# ============================================================
# 9. VISUALIZATIONS
# ============================================================

print("\nGenerating charts...")

# Chart 1: Monthly foot traffic by zone.
plt.figure(figsize=(12, 6))

for zone, group in monthly.groupby("zone_name"):
    plt.plot(
        group["month"],
        group["entries_per_coverage_hour"],
        marker="o",
        label=zone
    )

plt.title("Casino Foot Traffic by Zone")
plt.xlabel("Month")
plt.ylabel("Entries per Sensor Coverage Hour")
plt.xticks(rotation=45)
plt.legend()
plt.tight_layout()
plt.savefig(OUT / "q2_zone_foot_traffic.png", dpi=150)
plt.close()


# Chart 2: Machine demand vs. traffic for Back Forty.
if not back_forty.empty:
    fig, ax1 = plt.subplots(figsize=(11, 6))

    ax1.plot(
        back_forty["month"],
        back_forty["entries_per_coverage_hour"],
        marker="o",
        label="Foot traffic"
    )

    ax1.set_xlabel("Month")
    ax1.set_ylabel("Entries per Coverage Hour")

    ax2 = ax1.twinx()

    ax2.plot(
        back_forty["month"],
        back_forty["coin_in_per_available_hour"],
        marker="s",
        label="Machine coin-in per available hour"
    )

    ax2.set_ylabel("Coin-in per Available Machine Hour")

    plt.title("Back Forty: Foot Traffic vs. Machine Demand")
    fig.tight_layout()
    plt.savefig(
        OUT / "q2_back_forty_traffic_vs_demand.png",
        dpi=150
    )
    plt.close()


# Chart 3: Traffic vs. machine demand scatter plot.
plt.figure(figsize=(9, 6))

for zone, group in combined.groupby("zone_name"):
    plt.scatter(
        group["entries_per_coverage_hour"],
        group["coin_in_per_available_hour"],
        label=zone,
        alpha=0.5
    )

plt.title("Foot Traffic vs. Machine Demand")
plt.xlabel("Entries per Sensor Coverage Hour")
plt.ylabel("Coin-in per Available Machine Hour")
plt.legend()
plt.tight_layout()
plt.savefig(OUT / "q2_traffic_demand_scatter.png", dpi=150)
plt.close()


# ============================================================
# 10. PRINT RESULTS
# ============================================================

print("\n" + "=" * 70)
print("Q2 TRAFFIC ANALYSIS COMPLETE")
print("=" * 70)

print("\nJANUARY VS JUNE ZONE COMPARISON:")

display_columns = [
    "zone_name",
    "daily_coin_in_change_pct",
    "entries_per_coverage_hour_change_pct",
    "coin_in_per_available_hour_change_pct",
    "occupancy_rate_change_pct",
]

print(
    comparison[display_columns]
    .round(2)
    .to_string(index=False)
)

print("\nDAILY TRAFFIC-DEMAND CORRELATIONS:")

print(
    correlations
    .round(3)
    .to_string(index=False)
)

print("\nBACK FORTY MONTHLY RESULTS:")

print(
    back_forty[
        [
            "month",
            "entries_per_coverage_hour",
            "coin_in_per_available_hour",
            "occupancy_rate",
        ]
    ]
    .round(2)
    .to_string(index=False)
)

print(f"\nAll files saved to: {OUT.resolve()}")
