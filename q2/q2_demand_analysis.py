
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(".")
OUT = ROOT / "q2_outputs"
OUT.mkdir(exist_ok=True)

START = "2025-01-01"
END = "2025-06-30"

DAILY_FILE = ROOT / "data/1_prepared_views/prepared_daily_view.csv"
TRAFFIC_FILE = ROOT / "data/4_context/zone_traffic_hourly.csv.gz"
VISITOR_FILE = ROOT / "data/4_context/real_sources/city_visitation_monthly.csv.gz"
CANDIDATE_FILE = ROOT / "FINAL_BOTTOM_10_CANDIDATES.csv"

# ============================================================
# 1. LOAD AND CLEAN DATA
# ============================================================

df = pd.read_csv(DAILY_FILE)
df["gaming_date"] = pd.to_datetime(df["gaming_date"])
df = df[df["gaming_date"].between(START, END)].copy()

df["month"] = df["gaming_date"].dt.to_period("M").astype(str)

numeric_cols = [
    "coin_in_usd", "paid_spins",
    "occupied_hours", "available_hours",
    "zone_entries_observed",
    "zone_counter_coverage_hours"
]

for col in numeric_cols:
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

print("Loaded machine-day records:", len(df))
print("Unique machines:", df["machine_id"].nunique())
print("Zones:", df["zone_name"].nunique())
print("Themes:", df["theme"].nunique())

# ============================================================
# 2. OVERALL MONTHLY DEMAND
# ============================================================

monthly = df.groupby("month").agg(
    coin_in=("coin_in_usd", "sum"),
    paid_spins=("paid_spins", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"),
    machines=("machine_id", "nunique"),
    active_machine_days=("active", "sum"),
).reset_index()

monthly["occupancy_rate"] = (
    monthly["occupied_hours"] /
    monthly["available_hours"].replace(0, np.nan)
)

monthly["coin_in_per_available_hour"] = (
    monthly["coin_in"] /
    monthly["available_hours"].replace(0, np.nan)
)

monthly["spins_per_available_hour"] = (
    monthly["paid_spins"] /
    monthly["available_hours"].replace(0, np.nan)
)

monthly["coin_in_per_day"] = (
    monthly["coin_in"] /
    df.groupby("month")["gaming_date"].nunique().values
)

monthly.to_csv(OUT / "monthly_demand.csv", index=False)

# ============================================================
# 3. ZONE-LEVEL DEMAND
# ============================================================

zone_monthly = df.groupby(
    ["month", "zone_id", "zone_name"]
).agg(
    coin_in=("coin_in_usd", "sum"),
    paid_spins=("paid_spins", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"),
    machines=("machine_id", "nunique"),
).reset_index()

zone_monthly["occupancy_rate"] = (
    zone_monthly["occupied_hours"] /
    zone_monthly["available_hours"].replace(0, np.nan)
)

zone_monthly["coin_in_per_available_hour"] = (
    zone_monthly["coin_in"] /
    zone_monthly["available_hours"].replace(0, np.nan)
)

zone_monthly.to_csv(OUT / "zone_monthly_demand.csv", index=False)

# Compare January and June using average daily coin-in.
days = (
    df.groupby("month")["gaming_date"]
    .nunique()
    .rename("days")
)

zone_monthly = zone_monthly.merge(
    days, on="month", how="left"
)

zone_monthly["daily_coin_in"] = (
    zone_monthly["coin_in"] / zone_monthly["days"]
)

zone_pivot = zone_monthly.pivot(
    index=["zone_id", "zone_name"],
    columns="month",
    values="daily_coin_in"
).reset_index()

if "2025-01" in zone_pivot and "2025-06" in zone_pivot:
    zone_pivot["jan_to_june_change_pct"] = (
        (zone_pivot["2025-06"] - zone_pivot["2025-01"]) /
        zone_pivot["2025-01"].replace(0, np.nan)
    ) * 100

zone_pivot.to_csv(OUT / "zone_demand_change.csv", index=False)

# ============================================================
# 4. GAME THEME DEMAND
# ============================================================

theme_monthly = df.groupby(
    ["month", "theme"]
).agg(
    coin_in=("coin_in_usd", "sum"),
    paid_spins=("paid_spins", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"),
    machines=("machine_id", "nunique"),
).reset_index()

theme_monthly["occupancy_rate"] = (
    theme_monthly["occupied_hours"] /
    theme_monthly["available_hours"].replace(0, np.nan)
)

theme_monthly["coin_in_per_available_hour"] = (
    theme_monthly["coin_in"] /
    theme_monthly["available_hours"].replace(0, np.nan)
)

theme_monthly.to_csv(OUT / "theme_monthly_demand.csv", index=False)

# ============================================================
# 5. BACK FORTY ANALYSIS
# ============================================================

back_forty = zone_monthly[
    zone_monthly["zone_name"].str.contains(
        "Back Forty", case=False, na=False
    )
].copy()

back_forty.to_csv(
    OUT / "back_forty_monthly_demand.csv",
    index=False
)

# Compare Back Forty against the rest of the casino.
zone_monthly["zone_group"] = np.where(
    zone_monthly["zone_name"].str.contains(
        "Back Forty", case=False, na=False
    ),
    "Back Forty",
    "Other Zones"
)

back_comparison = zone_monthly.groupby(
    ["month", "zone_group"]
).agg(
    coin_in=("coin_in", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"),
    machines=("machines", "sum"),
).reset_index()

back_comparison["occupancy_rate"] = (
    back_comparison["occupied_hours"] /
    back_comparison["available_hours"].replace(0, np.nan)
)

back_comparison["coin_in_per_available_hour"] = (
    back_comparison["coin_in"] /
    back_comparison["available_hours"].replace(0, np.nan)
)

back_comparison.to_csv(
    OUT / "back_forty_vs_other_zones.csv",
    index=False
)

# ============================================================
# 6. REAL FLOOR TRAFFIC
# ============================================================

traffic = pd.read_csv(TRAFFIC_FILE)

traffic["hour_start_local"] = pd.to_datetime(
    traffic["hour_start_local"]
)

traffic = traffic[
    traffic["hour_start_local"].between(
        pd.Timestamp(START),
        pd.Timestamp(END) + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    )
].copy()

traffic["month"] = (
    traffic["hour_start_local"].dt.to_period("M").astype(str)
)

traffic["coverage_hours"] = (
    pd.to_numeric(traffic["coverage_minutes"], errors="coerce") / 60
)

traffic["entries_count"] = pd.to_numeric(
    traffic["entries_count"], errors="coerce"
).fillna(0)

# Only use valid sensor observations.
traffic = traffic[
    traffic["counter_status"].eq("ok") &
    (traffic["coverage_hours"] > 0)
]

traffic_monthly = traffic.groupby(
    ["month", "zone_id"]
).agg(
    entries=("entries_count", "sum"),
    coverage_hours=("coverage_hours", "sum"),
).reset_index()

traffic_monthly["entries_per_coverage_hour"] = (
    traffic_monthly["entries"] /
    traffic_monthly["coverage_hours"]
)

traffic_monthly.to_csv(
    OUT / "zone_traffic_monthly.csv",
    index=False
)

# ============================================================
# 7. EXTERNAL TOURISM CONTEXT
# ============================================================

if VISITOR_FILE.exists():
    visitors = pd.read_csv(VISITOR_FILE)

    visitors = visitors[
        visitors["geography"].eq("Las Vegas")
    ].copy()

    visitor_cols = [
        "month",
        "visitor_volume",
        "visitor_yoy_ratio",
        "hotel_occupancy_ratio",
        "convention_attendance",
        "airport_en_deplaned_passengers"
    ]

    visitor_cols = [
        c for c in visitor_cols if c in visitors.columns
    ]

    visitors = visitors[visitor_cols]

    monthly_context = monthly.merge(
        visitors, on="month", how="left"
    )

    monthly_context.to_csv(
        OUT / "monthly_demand_with_tourism.csv",
        index=False
    )

# ============================================================
# 8. BACK FORTY: OUR Q1 CANDIDATES
# ============================================================

if CANDIDATE_FILE.exists():
    candidates = pd.read_csv(CANDIDATE_FILE)

    candidate_ids = candidates["machine_id"].unique()

    candidate_trends = df[
        df["machine_id"].isin(candidate_ids)
    ].groupby(
        ["month", "machine_id", "theme", "zone_name"]
    ).agg(
        coin_in=("coin_in_usd", "sum"),
        occupied_hours=("occupied_hours", "sum"),
        available_hours=("available_hours", "sum"),
        paid_spins=("paid_spins", "sum"),
    ).reset_index()

    candidate_trends["occupancy_rate"] = (
        candidate_trends["occupied_hours"] /
        candidate_trends["available_hours"].replace(0, np.nan)
    )

    candidate_trends.to_csv(
        OUT / "q1_candidates_monthly_trends.csv",
        index=False
    )

# ============================================================
# 9. VISUALIZATIONS
# ============================================================

def save_chart(filename):
    plt.tight_layout()
    plt.savefig(OUT / filename, dpi=160, bbox_inches="tight")
    plt.close()

# Overall coin-in
plt.figure(figsize=(10, 5))
plt.plot(
    monthly["month"], monthly["coin_in"],
    marker="o", label="Total coin-in"
)
plt.title("Casino Monthly Coin-In")
plt.xlabel("Month")
plt.ylabel("Coin-In ($)")
plt.xticks(rotation=45)
plt.legend()
save_chart("monthly_coin_in.png")

# Overall occupancy
plt.figure(figsize=(10, 5))
plt.plot(
    monthly["month"],
    monthly["occupancy_rate"] * 100,
    marker="o"
)
plt.title("Casino Monthly Occupancy")
plt.xlabel("Month")
plt.ylabel("Occupancy (%)")
plt.xticks(rotation=45)
save_chart("monthly_occupancy.png")

# Zone demand
plt.figure(figsize=(12, 6))
for zone, group in zone_monthly.groupby("zone_name"):
    plt.plot(
        group["month"],
        group["coin_in"] / group["days"],
        marker="o",
        label=zone
    )
plt.title("Average Daily Coin-In by Zone")
plt.xlabel("Month")
plt.ylabel("Daily Coin-In ($)")
plt.xticks(rotation=45)
plt.legend()
save_chart("zone_demand_trends.png")

# Theme demand
plt.figure(figsize=(12, 6))
for theme, group in theme_monthly.groupby("theme"):
    plt.plot(
        group["month"],
        group["coin_in_per_available_hour"],
        marker="o",
        label=theme
    )
plt.title("Game Theme Demand: Coin-In per Available Hour")
plt.xlabel("Month")
plt.ylabel("Coin-In ($/available hour)")
plt.xticks(rotation=45)
plt.legend()
save_chart("theme_demand_trends.png")

# Back Forty vs other zones
plt.figure(figsize=(10, 5))
for group_name, group in back_comparison.groupby("zone_group"):
    plt.plot(
        group["month"],
        group["coin_in_per_available_hour"],
        marker="o",
        label=group_name
    )
plt.title("Back Forty vs Other Zones")
plt.xlabel("Month")
plt.ylabel("Coin-In per Available Hour ($)")
plt.xticks(rotation=45)
plt.legend()
save_chart("back_forty_comparison.png")

print("\nQ2 analysis complete!")
print("All results saved in:", OUT.resolve())

print("\nMONTHLY DEMAND:")
print(monthly.round(2).to_string(index=False))

print("\nZONE DEMAND CHANGE:")
print(zone_pivot.round(2).to_string(index=False))
