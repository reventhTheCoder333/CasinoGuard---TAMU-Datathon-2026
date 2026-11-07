
import pandas as pd

df = pd.read_csv(
    "data/1_prepared_views/prepared_daily_view.csv"
)

# Only use records where machine meters were reported
reported = df[df["meter_status"] == "reported"].copy()

summary = reported.groupby("machine_id").agg(
    reported_days=("gaming_date", "count"),
    coin_in=("coin_in_usd", "sum"),
    house_win=("house_win_usd", "sum"),
    theo=("theo_usd", "sum"),
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    luck=("luck_residual_usd", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    availability=("availability_ratio", "mean"),
    faults=("faults_opened", "sum")
)

# Normalize performance by available operating time
summary["theo_per_hour"] = (
    summary["theo"] / summary["available_hours"]
)

summary["contribution_per_hour"] = (
    summary["contribution"] / summary["available_hours"]
)

summary["coin_in_per_hour"] = (
    summary["coin_in"] / summary["available_hours"]
)

# Weighted occupancy: total occupied hours / total available hours
summary["occupancy"] = (
    summary["occupied_hours"] / summary["available_hours"]
)

# Actual performance compared with theoretical performance
summary["actual_vs_theo"] = (
    summary["house_win"] - summary["theo"]
)

print("\nTOTAL MACHINES:", len(summary))

print("\nMACHINES WITH FEWEST REPORTED DAYS:")
print(
    summary.sort_values("reported_days")
    [["reported_days", "available_hours"]]
    .head(10).round(2).to_string()
)

columns = [
    "reported_days",
    "theo_per_hour",
    "contribution_per_hour",
    "occupancy",
    "availability",
    "faults",
    "luck"
]

print("\n15 LOWEST MACHINES BY THEORETICAL WIN PER HOUR:")
print(
    summary.sort_values("theo_per_hour")[columns]
    .head(15).round(3).to_string()
)

print("\n15 LOWEST MACHINES BY CONTRIBUTION PER HOUR:")
print(
    summary.sort_values("contribution_per_hour")[columns]
    .head(15).round(3).to_string()
)

print("\n15 LOWEST MACHINES BY OCCUPANCY:")
print(
    summary.sort_values("occupancy")[columns]
    .head(15).round(3).to_string()
)
