
import pandas as pd


def detect_rapid_cashouts(
    transactions,
    min_cashout_ratio=0.80,
    max_wager_ratio=0.20,
    max_time_minutes=60
):
    if not transactions:
        return []

    df = pd.DataFrame(transactions)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601")

    df = df.sort_values("timestamp")

    findings = []

    # Analyze each account independently
    for account, group in df.groupby("account"):

        group = group.reset_index(drop=True)

        # Find every deposit
        deposits = group[group["type"] == "deposit"]

        for _, deposit in deposits.iterrows():

            deposit_amount = deposit["amount"]
            deposit_time = deposit["timestamp"]

            # Transactions occurring after the deposit
            # and within the specified time window
            window = group[
                (group["timestamp"] > deposit_time) &
                (group["timestamp"] <= deposit_time +
                 pd.Timedelta(minutes=max_time_minutes))
            ]

            # Calculate total withdrawals and wagers
            withdrawals = window[
                window["type"] == "withdrawal"
            ]

            wagers = window[
                window["type"] == "wager"
            ]

            total_withdrawn = withdrawals["amount"].sum()
            total_wagered = wagers["amount"].sum()

            # Calculate ratios
            cashout_ratio = total_withdrawn / deposit_amount
            wager_ratio = total_wagered / deposit_amount

            # Check for rapid cash-out behavior
            if (
                cashout_ratio >= min_cashout_ratio
                and wager_ratio <= max_wager_ratio
                and len(withdrawals) > 0
            ):
                first_withdrawal_time = withdrawals[
                    "timestamp"
                ].min()

                elapsed_minutes = (
                    first_withdrawal_time - deposit_time
                ).total_seconds() / 60

                findings.append({
                    "pattern": "rapid_cashout",
                    "account": account,
                    "deposit_id": deposit["id"],
                    "withdrawal_ids": withdrawals["id"].tolist(),
                    "deposit_amount": float(deposit_amount),
                    "total_withdrawn": float(total_withdrawn),
                    "total_wagered": float(total_wagered),
                    "cashout_ratio": round(float(cashout_ratio), 4),
                    "wager_ratio": round(float(wager_ratio), 4),
                    "elapsed_minutes": round(elapsed_minutes, 2)
                })

    return findings
