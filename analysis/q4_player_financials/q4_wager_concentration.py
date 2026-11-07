import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd
import numpy as np

players = pd.read_csv("analysis/q4_player_financials/outputs/q4_player_level_results.csv")

# Sort players by wagering, highest first
ranked = players.sort_values(
    "total_wagered", ascending=False
).reset_index(drop=True)

total_wagered = ranked["total_wagered"].sum()
n = len(ranked)

print("\n========== WAGERING CONCENTRATION ==========")

for percentage in [1, 5, 10, 20]:
    count = max(1, int(np.ceil(n * percentage / 100)))

    top_wager = ranked.head(count)["total_wagered"].sum()
    share = top_wager / total_wagered * 100

    print(
        f"Top {percentage}% ({count} players): "
        f"${top_wager:,.2f} "
        f"({share:.2f}% of total wagering)"
    )

# Gini coefficient
def gini(values):
    values = np.asarray(values, dtype=float)
    values = np.sort(values)

    if len(values) == 0 or values.sum() == 0:
        return np.nan

    n = len(values)
    index = np.arange(1, n + 1)

    return (
        2 * np.sum(index * values) /
        (n * np.sum(values))
        - (n + 1) / n
    )

print("\nWagering Gini coefficient:",
      round(gini(players["total_wagered"]), 4))

ranked.to_csv("analysis/q4_player_financials/outputs/q4_wagering_ranked.csv", index=False)
