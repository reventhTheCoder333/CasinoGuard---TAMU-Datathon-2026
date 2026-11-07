import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


from pathlib import Path

import pandas as pd


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(".")
OUT = ROOT / "analysis/q2_floor_demand/outputs"
OUT.mkdir(exist_ok=True)

DAILY_FILE = ROOT / "data/1_prepared_views/prepared_daily_view.csv"
HOURLY_FILE = ROOT / "data/5_optional/machine_hour.csv.gz"

START = "2025-01-01"
END = "2025-06-30"


# ============================================================
# 1. LOAD DATA
# ============================================================

print("Loading casino demand data...")

daily = pd.read_csv(DAILY_FILE)
hourly = pd.read_csv(HOURLY_FILE)

daily["gaming_date"] = pd.to_datetime(daily["gaming_date"])
hourly["gaming_date"] = pd.to_datetime(hourly["gaming_date"])

daily = daily[
    daily["gaming_date"].between(START, END)
].copy()

hourly = hourly[
    hourly["gaming_date"].between(START, END)
].copy()

print(f"Daily records: {len(daily):,}")
print(f"Hourly records: {len(hourly):,}")


# ============================================================
# 2. WEEKDAY VS WEEKEND DEMAND
# ============================================================

print("\nAnalyzing weekday and weekend demand...")

weekday_zone = (
    daily.groupby(
        ["is_weekend", "zone_id", "zone_name"],
        as_index=False
    )
    .agg(
        total_coin_in=("coin_in_usd", "sum"),
        total_spins=("paid_spins", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
        machine_days=("machine_id", "count"),
        active_machine_days=("active", "sum"),
        gaming_days=("gaming_date", "nunique"),
    )
)

weekday_zone["occupancy_rate"] = (
    weekday_zone["occupied_hours"]
    / weekday_zone["available_hours"].replace(0, pd.NA)
)

weekday_zone["coin_in_per_available_hour"] = (
    weekday_zone["total_coin_in"]
    / weekday_zone["available_hours"].replace(0, pd.NA)
)

weekday_zone["spins_per_available_hour"] = (
    weekday_zone["total_spins"]
    / weekday_zone["available_hours"].replace(0, pd.NA)
)

weekday_zone["daily_coin_in"] = (
    weekday_zone["total_coin_in"]
    / weekday_zone["gaming_days"]
)

weekday_zone["day_type"] = weekday_zone["is_weekend"].map({
    True: "Weekend",
    False: "Weekday"
})

weekday_zone.to_csv(
    OUT / "q2_weekday_weekend_by_zone.csv",
    index=False
)


# ============================================================
# 3. OVERALL WEEKDAY VS WEEKEND COMPARISON
# ============================================================

overall_day_type = (
    daily.groupby("is_weekend", as_index=False)
    .agg(
        total_coin_in=("coin_in_usd", "sum"),
        total_spins=("paid_spins", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
        machine_days=("machine_id", "count"),
        gaming_days=("gaming_date", "nunique"),
    )
)

overall_day_type["day_type"] = overall_day_type[
    "is_weekend"
].map({
    True: "Weekend",
    False: "Weekday"
})

overall_day_type["coin_in_per_available_hour"] = (
    overall_day_type["total_coin_in"]
    / overall_day_type["available_hours"].replace(0, pd.NA)
)

overall_day_type["occupancy_rate"] = (
    overall_day_type["occupied_hours"]
    / overall_day_type["available_hours"].replace(0, pd.NA)
)

overall_day_type["daily_coin_in"] = (
    overall_day_type["total_coin_in"]
    / overall_day_type["gaming_days"]
)

overall_day_type.to_csv(
    OUT / "q2_overall_weekday_weekend.csv",
    index=False
)


# ============================================================
# 4. MERGE HOURLY DATA WITH ZONE INFORMATION
# ============================================================

print("\nMapping hourly machine records to casino zones...")

# Each machine has a zone assignment for each gaming date.
zone_lookup = daily[
    [
        "machine_id",
        "gaming_date",
        "zone_id",
        "zone_name",
        "local_weekday",
        "is_weekend",
    ]
].drop_duplicates(
    ["machine_id", "gaming_date"]
)

hourly = hourly.merge(
    zone_lookup,
    on=["machine_id", "gaming_date"],
    how="left",
    validate="many_to_one"
)

unmapped = hourly["zone_id"].isna().sum()

print(f"Hourly records without a zone mapping: {unmapped:,}")

hourly = hourly.dropna(subset=["zone_id"]).copy()

# Convert cents to dollars.
hourly["coin_in_usd"] = hourly["coin_in_cents"] / 100

# Convert seconds to hours.
hourly["available_hours"] = (
    hourly["available_seconds"] / 3600
)

hourly["occupied_hours"] = (
    hourly["occupied_seconds"] / 3600
)


# ============================================================
# 5. HOURLY DEMAND BY LOCAL HOUR
# ============================================================

print("\nAnalyzing demand by hour of day...")

hourly_demand = (
    hourly.groupby(
        ["local_hour", "zone_id", "zone_name"],
        as_index=False
    )
    .agg(
        total_coin_in=("coin_in_usd", "sum"),
        total_spins=("paid_spins", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
        observations=("machine_id", "count"),
    )
)

hourly_demand["coin_in_per_available_hour"] = (
    hourly_demand["total_coin_in"]
    / hourly_demand["available_hours"].replace(0, pd.NA)
)

hourly_demand["occupancy_rate"] = (
    hourly_demand["occupied_hours"]
    / hourly_demand["available_hours"].replace(0, pd.NA)
)

hourly_demand["spins_per_available_hour"] = (
    hourly_demand["total_spins"]
    / hourly_demand["available_hours"].replace(0, pd.NA)
)

hourly_demand.to_csv(
    OUT / "q2_hourly_demand_by_zone.csv",
    index=False
)


# ============================================================
# 6. OVERALL HOURLY DEMAND
# ============================================================

overall_hourly = (
    hourly.groupby("local_hour", as_index=False)
    .agg(
        total_coin_in=("coin_in_usd", "sum"),
        total_spins=("paid_spins", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
    )
)

overall_hourly["coin_in_per_available_hour"] = (
    overall_hourly["total_coin_in"]
    / overall_hourly["available_hours"].replace(0, pd.NA)
)

overall_hourly["occupancy_rate"] = (
    overall_hourly["occupied_hours"]
    / overall_hourly["available_hours"].replace(0, pd.NA)
)

overall_hourly["spins_per_available_hour"] = (
    overall_hourly["total_spins"]
    / overall_hourly["available_hours"].replace(0, pd.NA)
)

overall_hourly.to_csv(
    OUT / "q2_overall_hourly_demand.csv",
    index=False
)


# ============================================================
# 7. WEEKDAY VS WEEKEND HOURLY COMPARISON
# ============================================================

print("\nComparing hourly weekday and weekend demand...")

hourly_day_type = (
    hourly.groupby(
        ["is_weekend", "local_hour"],
        as_index=False
    )
    .agg(
        total_coin_in=("coin_in_usd", "sum"),
        total_spins=("paid_spins", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
    )
)

hourly_day_type["coin_in_per_available_hour"] = (
    hourly_day_type["total_coin_in"]
    / hourly_day_type["available_hours"].replace(0, pd.NA)
)

hourly_day_type["occupancy_rate"] = (
    hourly_day_type["occupied_hours"]
    / hourly_day_type["available_hours"].replace(0, pd.NA)
)

hourly_day_type["day_type"] = hourly_day_type[
    "is_weekend"
].map({
    True: "Weekend",
    False: "Weekday"
})

hourly_day_type.to_csv(
    OUT / "q2_hourly_weekday_weekend.csv",
    index=False
)


# ============================================================
# 8. IDENTIFY PEAK DEMAND HOURS
# ============================================================

print("\nIdentifying peak demand periods...")

peak_hours = (
    overall_hourly.sort_values(
        "coin_in_per_available_hour",
        ascending=False
    )
    .head(5)
)

peak_hours.to_csv(
    OUT / "q2_top_5_peak_hours.csv",
    index=False
)

zone_peak_hours = (
    hourly_demand.sort_values(
        "coin_in_per_available_hour",
        ascending=False
    )
    .groupby("zone_name")
    .head(3)
    .sort_values(
        ["zone_name", "coin_in_per_available_hour"],
        ascending=[True, False]
    )
)

zone_peak_hours.to_csv(
    OUT / "q2_peak_hours_by_zone.csv",
    index=False
)


# ============================================================
# 9. BACK FORTY TIME-OF-DAY ANALYSIS
# ============================================================

print("\nAnalyzing Back Forty hourly demand...")

back_forty = hourly_demand[
    hourly_demand["zone_name"].str.lower() == "back forty"
].copy()

back_forty = back_forty.sort_values("local_hour")

back_forty.to_csv(
    OUT / "q2_back_forty_hourly_demand.csv",
    index=False
)


# ============================================================
# 10. PRINT RESULTS
# ============================================================

print("\n" + "=" * 70)
print("Q2 TIME-BASED DEMAND ANALYSIS COMPLETE")
print("=" * 70)

print("\nOVERALL WEEKDAY VS WEEKEND:")

print(
    overall_day_type[
        [
            "day_type",
            "daily_coin_in",
            "coin_in_per_available_hour",
            "occupancy_rate",
            "gaming_days",
        ]
    ].round(3).to_string(index=False)
)

print("\nTOP FIVE PEAK HOURS:")

print(
    peak_hours[
        [
            "local_hour",
            "coin_in_per_available_hour",
            "occupancy_rate",
            "spins_per_available_hour",
        ]
    ].round(3).to_string(index=False)
)

print("\nTOP THREE HOURS BY ZONE:")

print(
    zone_peak_hours[
        [
            "zone_name",
            "local_hour",
            "coin_in_per_available_hour",
            "occupancy_rate",
        ]
    ].round(3).to_string(index=False)
)

print("\nBACK FORTY HOURLY DEMAND:")

print(
    back_forty[
        [
            "local_hour",
            "coin_in_per_available_hour",
            "occupancy_rate",
            "spins_per_available_hour",
        ]
    ].round(3).to_string(index=False)
)

print(f"\nAll results saved to: {OUT.resolve()}")
