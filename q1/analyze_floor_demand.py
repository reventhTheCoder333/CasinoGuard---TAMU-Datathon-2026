
import pandas as pd

# Load data
machines = pd.read_csv(
    "data/1_prepared_views/prepared_daily_view.csv"
)

locations = pd.read_csv(
    "data/2_machine_decision/floor_locations.csv"
)

traffic = pd.read_csv(
    "data/4_context/zone_traffic_hourly.csv.gz"
)

# Only use reported machine records
machines = machines[
    machines["meter_status"] == "reported"
].copy()

# Map each machine to its physical floor location
location_map = locations[
    ["location_id", "zone_id", "bank_id", "node_type", "x_m", "y_m"]
].drop_duplicates("location_id")

machines = machines.merge(
    location_map,
    on="location_id",
    how="left",
    suffixes=("", "_layout")
)

# Prepare hourly traffic observations
traffic["hour_start_local"] = pd.to_datetime(
    traffic["hour_start_local"]
)

traffic["gaming_date"] = (
    traffic["hour_start_local"].dt.date.astype(str)
)

# Exclude invalid sensor readings
valid = traffic[
    (traffic["counter_status"] == "ok") &
    (traffic["coverage_minutes"] > 0) &
    (traffic["entries_count"].notna())
].copy()

# Aggregate traffic by zone and date
daily_traffic = valid.groupby(
    ["zone_id", "gaming_date"]
).agg(
    entries=("entries_count", "sum"),
    coverage_minutes=("coverage_minutes", "sum")
).reset_index()

daily_traffic["entries_per_coverage_hour"] = (
    daily_traffic["entries"] /
    (daily_traffic["coverage_minutes"] / 60)
)

# Attach daily traffic to machine-day records
machines["gaming_date"] = machines[
    "gaming_date"
].astype(str)

machines = machines.merge(
    daily_traffic[
        ["zone_id", "gaming_date", "entries_per_coverage_hour"]
    ],
    on=["zone_id", "gaming_date"],
    how="left"
)

# Machine-level summary
summary = machines.groupby("machine_id").agg(
    config_id=("config_id", "first"),
    zone_id=("zone_id", "first"),
    location_id=("location_id", "first"),
    bank_id=("bank_id", "first"),
    days=("gaming_date", "nunique"),
    theo=("theo_usd", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    avg_zone_traffic=("entries_per_coverage_hour", "mean")
).reset_index()

summary["theo_per_hour"] = (
    summary["theo"] / summary["available_hours"]
)

summary["contribution_per_hour"] = (
    summary["contribution"] / summary["available_hours"]
)

summary["occupancy"] = (
    summary["occupied_hours"] / summary["available_hours"]
)

# Compare occupancy against machines in the same zone
summary["zone_occupancy_percentile"] = (
    summary.groupby("zone_id")["occupancy"]
    .rank(pct=True) * 100
)

# Zone-level traffic summary
zone_summary = summary.groupby("zone_id").agg(
    machines=("machine_id", "count"),
    avg_traffic=("avg_zone_traffic", "mean"),
    avg_occupancy=("occupancy", "mean"),
    avg_theo_per_hour=("theo_per_hour", "mean")
).reset_index()

print("\nZONE-LEVEL DEMAND")
print(
    zone_summary.sort_values("avg_traffic", ascending=False)
    .round(3).to_string(index=False)
)

print("\nLOWEST OCCUPANCY MACHINES WITH THEIR ZONE TRAFFIC")
print(
    summary.sort_values("occupancy")
    [[
        "machine_id",
        "config_id",
        "zone_id",
        "location_id",
        "bank_id",
        "avg_zone_traffic",
        "occupancy",
        "zone_occupancy_percentile",
        "theo_per_hour",
        "contribution_per_hour"
    ]].head(25).round(3).to_string(index=False)
)

print("\nMACHINES WITH LOW OCCUPANCY RELATIVE TO THEIR ZONE")
print(
    summary[
        summary["zone_occupancy_percentile"] <= 25
    ].sort_values("zone_occupancy_percentile")
    [[
        "machine_id",
        "config_id",
        "zone_id",
        "avg_zone_traffic",
        "occupancy",
        "zone_occupancy_percentile",
        "theo_per_hour",
        "contribution_per_hour"
    ]].head(25).round(3).to_string(index=False)
)

print("\nTRAFFIC DATA COVERAGE")
print("Valid hourly observations:", len(valid))
print("Total hourly observations:", len(traffic))
print("Zones with traffic:", valid["zone_id"].nunique())
print("Zones with no valid readings:",
      set(machines["zone_id"].dropna().unique()) -
      set(valid["zone_id"].unique()))
