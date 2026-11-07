
import pandas as pd

df = pd.read_csv(
    "data/1_prepared_views/prepared_daily_view.csv"
)

df = df[df["meter_status"] == "reported"].copy()

# How many different configurations and locations does each machine use?
machine_groups = df.groupby("machine_id").agg(
    configs=("config_id", "nunique"),
    themes=("theme", "nunique"),
    volatility_classes=("volatility_class", "nunique"),
    manufacturers=("manufacturer", "nunique"),
    zones=("zone_name", "nunique")
)

print("\nMACHINE CONFIGURATION CHANGES")
print(machine_groups.describe().round(2))

print("\nMACHINES WITH MULTIPLE CONFIGURATIONS")
print(
    machine_groups[machine_groups["configs"] > 1]
    .head(20).to_string()
)

# Number of machines in each game configuration
config_counts = (
    df.groupby(["config_id", "theme", "volatility_class"])
    ["machine_id"]
    .nunique()
    .reset_index(name="machine_count")
    .sort_values("machine_count", ascending=False)
)

print("\nMOST COMMON GAME CONFIGURATIONS")
print(config_counts.head(20).to_string(index=False))

# Performance comparison by configuration
performance = df.groupby(
    ["machine_id", "config_id", "theme", "volatility_class"]
).agg(
    theo=("theo_usd", "sum"),
    available_hours=("available_hours", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    days=("gaming_date", "count")
).reset_index()

performance["theo_per_hour"] = (
    performance["theo"] / performance["available_hours"]
)

print("\nCONFIGURATION-LEVEL PERFORMANCE")
print(
    performance.sort_values("theo_per_hour")
    .head(20).round(2).to_string(index=False)
)
