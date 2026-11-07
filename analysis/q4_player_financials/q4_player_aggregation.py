import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd
import numpy as np

# Load dataset
df = pd.read_csv("data/1_prepared_views/player_period.csv")

# Validate required columns
required = [
    "player_id",
    "tracked_coin_in_usd",
    "tracked_payout_usd",
    "tracked_net_usd",
    "theo_usd",
    "luck_residual_usd",
    "sessions",
    "carded_play_hours",
    "incomplete_visits"
]

missing = set(required) - set(df.columns)
if missing:
    raise ValueError(f"Missing columns: {missing}")

# Aggregate monthly records into player-level records
players = df.groupby("player_id").agg(
    total_wagered=("tracked_coin_in_usd", "sum"),
    total_returned=("tracked_payout_usd", "sum"),
    recorded_net=("tracked_net_usd", "sum"),
    theoretical_win=("theo_usd", "sum"),
    luck_residual=("luck_residual_usd", "sum"),
    total_sessions=("sessions", "sum"),
    play_hours=("carded_play_hours", "sum"),
    incomplete_visits=("incomplete_visits", "sum"),
    active_months=("period_month", "nunique")
).reset_index()

# Recalculate casino and player net results
players["casino_net"] = (
    players["total_wagered"] - players["total_returned"]
)

players["player_net"] = -players["casino_net"]

# Calculate payout ratio
players["return_rate"] = np.where(
    players["total_wagered"] > 0,
    players["total_returned"] / players["total_wagered"],
    np.nan
)

# Save
players.to_csv("analysis/q4_player_financials/outputs/q4_player_level_results.csv", index=False)

print("PLAYER AGGREGATION COMPLETE")
print("Tracked players:", len(players))
print(players.head())

print("\nReconciliation check:")
print("Recorded net matches calculated casino net:",
      np.allclose(players["recorded_net"], players["casino_net"]))

print("\nSaved: q4_player_level_results.csv")
