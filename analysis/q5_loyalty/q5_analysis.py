import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

base = "data/1_prepared_views/"
guest = "data/3_guests/"

players = pd.read_csv(base + "player_period.csv")
daily = pd.read_csv(base + "prepared_daily_view.csv") if False else pd.read_csv(base + "property_day.csv")
ledger = pd.read_csv(guest + "loyalty_ledger.csv")

# 1. Overall loyalty program economics
print("\n========== OVERALL COMP COST ==========")
print("Actual economic cost:", players["comp_cost_usd"].sum())
print("Total face value:", players["comp_face_value_usd"].sum())
print("Total comps redeemed:", players["comps_redeemed"].sum())
print("Average cost per player:",
      players.groupby("player_id")["comp_cost_usd"].sum().mean())

print("\n========== PROPERTY RECONCILIATION ==========")
print("Daily property comp cost:", daily["comp_cost_usd"].sum())
print("Daily property face value:", daily["comp_face_value_usd"].sum())

# 2. Monthly loyalty spending
print("\n========== MONTHLY COMP COST ==========")
monthly = players.groupby("period_month").agg(
    comp_cost=("comp_cost_usd", "sum"),
    face_value=("comp_face_value_usd", "sum"),
    redemptions=("comps_redeemed", "sum"),
    players=("player_id", "nunique"),
    tracked_theo=("theo_usd", "sum")
)
monthly["cost_per_player"] = monthly["comp_cost"] / monthly["players"]
monthly["comp_cost_pct_theo"] = (
    monthly["comp_cost"] / monthly["tracked_theo"] * 100
)
print(monthly.round(2).to_string())

# 3. Loyalty ledger event analysis
print("\n========== LOYALTY EVENT TYPES ==========")
print(ledger["event_type"].value_counts(dropna=False))

print("\n========== LEDGER ECONOMIC COST ==========")
print("Total economic cost:",
      ledger["economic_cost_cents"].sum() / 100)
print("Total face value:",
      ledger["face_value_cents"].sum() / 100)

# 4. Monthly ledger activity
ledger["month"] = pd.to_datetime(
    ledger["event_at_utc"]
).dt.to_period("M").astype(str)

print("\n========== MONTHLY LEDGER ACTIVITY ==========")
print(
    ledger.groupby(["month", "event_type"]).agg(
        events=("loyalty_event_id", "count"),
        points=("points_delta", "sum"),
        economic_cost_cents=("economic_cost_cents", "sum"),
        face_value_cents=("face_value_cents", "sum")
    ).to_string()
)

# 5. Tier changes
print("\n========== TIER CHANGES ==========")
transitions = ledger[
    ledger["tier_before"].notna() &
    ledger["tier_after"].notna() &
    (ledger["tier_before"] != ledger["tier_after"])
]

print("Total tier transitions:", len(transitions))
print(transitions.groupby(
    ["tier_before", "tier_after"]
).size().to_string())

print("\n========== MONTHLY TIER CHANGES ==========")
print(
    transitions.assign(
        month=pd.to_datetime(
            transitions["event_at_utc"]
        ).dt.to_period("M").astype(str)
    ).groupby("month").size().to_string()
)
