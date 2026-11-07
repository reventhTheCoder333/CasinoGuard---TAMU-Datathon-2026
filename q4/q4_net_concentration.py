
import pandas as pd
import numpy as np

players = pd.read_csv("q4_player_level_results.csv")

# Casino net is positive when the player loses
players["casino_net"] = (
    players["total_wagered"] - players["total_returned"]
)

# Separate player losses and player winnings
losing_players = players[players["casino_net"] > 0].copy()
winning_players = players[players["casino_net"] < 0].copy()

total_casino_net = players["casino_net"].sum()

print("\n========== NET RESULT CONCENTRATION ==========")

print(f"Total casino net: ${total_casino_net:,.2f}")

print(f"Players with net losses: {len(losing_players):,}")
print(f"Players with net winnings: {len(winning_players):,}")

print(
    "Total losses from losing players: "
    f"${losing_players['casino_net'].sum():,.2f}"
)

print(
    "Total winnings paid to winning players: "
    f"${-winning_players['casino_net'].sum():,.2f}"
)

# Concentration of gross player losses
losing_ranked = losing_players.sort_values(
    "casino_net", ascending=False
)

gross_losses = losing_ranked["casino_net"].sum()

for pct in [1, 5, 10, 20]:
    count = max(1, int(np.ceil(len(losing_ranked) * pct / 100)))

    top_losses = losing_ranked.head(count)["casino_net"].sum()

    share = (
        top_losses / gross_losses * 100
        if gross_losses > 0 else np.nan
    )

    print(
        f"Top {pct}% of losing players: "
        f"{share:.2f}% of gross player losses"
    )

losing_ranked.to_csv("q4_largest_player_losses.csv", index=False)
