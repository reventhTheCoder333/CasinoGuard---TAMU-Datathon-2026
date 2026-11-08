import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd
import numpy as np

players = pd.read_csv("analysis/q4_player_financials/outputs/q4_player_level_results.csv")

# Sort by total wagering
players = players.sort_values(
    "total_wagered", ascending=False
).reset_index(drop=True)

# Normalize financial results by playing hours
players["wager_per_hour"] = np.where(
    players["play_hours"] > 0,
    players["total_wagered"] / players["play_hours"],
    np.nan
)

players["casino_net_per_hour"] = np.where(
    players["play_hours"] > 0,
    players["casino_net"] / players["play_hours"],
    np.nan
)

# Compare actual casino net against theoretical win
players["theo_difference"] = (
    players["casino_net"] - players["theoretical_win"]
)

print("\n========== PLAYER EXPOSURE AND LUCK ==========")

print("Total theoretical win:",
      f"${players['theoretical_win'].sum():,.2f}")

print("Total actual casino net:",
      f"${players['casino_net'].sum():,.2f}")

print("Actual minus theoretical:",
      f"${players['theo_difference'].sum():,.2f}")

print("\nTop 10 wagering players:")
print(
    players[
        [
            "player_id",
            "total_wagered",
            "total_returned",
            "player_net",
            "theoretical_win",
            "luck_residual",
            "play_hours",
            "wager_per_hour"
        ]
    ].head(10).to_string(index=False)
)

players.to_csv("analysis/q4_player_financials/outputs/q4_player_exposure_analysis.csv", index=False)
