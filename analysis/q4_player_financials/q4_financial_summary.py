import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

players = pd.read_csv("analysis/q4_player_financials/outputs/q4_player_level_results.csv")

total_wagered = players["total_wagered"].sum()
total_returned = players["total_returned"].sum()

casino_net = total_wagered - total_returned
player_net = -casino_net

return_rate = total_returned / total_wagered * 100

print("\n========== Q4 OVERALL FINANCIAL RESULTS ==========")

print(f"Tracked players: {len(players):,}")
print(f"Total wagered: ${total_wagered:,.2f}")
print(f"Total returned: ${total_returned:,.2f}")
print(f"Player net: ${player_net:,.2f}")
print(f"Casino net: ${casino_net:,.2f}")
print(f"Aggregate return rate: {return_rate:.2f}%")

print(f"\nAverage wager per player: ${players['total_wagered'].mean():,.2f}")
print(f"Median wager per player: ${players['total_wagered'].median():,.2f}")

print("\nPlayer outcomes:")
print("Players with net losses:",
      (players["player_net"] < 0).sum())
print("Players with net winnings:",
      (players["player_net"] > 0).sum())
print("Players breaking even:",
      (players["player_net"] == 0).sum())
