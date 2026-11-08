
import pandas as pd

from detectors.constants import is_house_account


def detect_structuring(
    transactions,
    threshold=10000,
    window_minutes=60,
    min_transactions=3
):
    if not transactions:
        return []

    # Convert transactions into a DataFrame
    df = pd.DataFrame(transactions)

    # Parse timestamps
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601")

    # Structuring means splitting a sum into pieces below the threshold, sent
    # by a customer. Casino payouts and single large transactions are neither.
    df = df[
        ~df["from"].map(is_house_account)
        & (df["amount"] < threshold)
    ]

    # Wagers spend funds already deposited; counting them would add the same
    # money again each time it is bet.
    if "type" in df:
        df = df[df["type"] != "wager"]

    # Sort transactions by account and time
    df = df.sort_values(["from", "timestamp"])

    findings = []

    # Analyze each account independently
    for account, group in df.groupby("from"):

        group = group.sort_values("timestamp").reset_index(drop=True)

        # Check every transaction as the end of a rolling window
        for i in range(len(group)):
            end_time = group.loc[i, "timestamp"]
            start_time = end_time - pd.Timedelta(minutes=window_minutes)

            window = group[
                (group["timestamp"] > start_time) &
                (group["timestamp"] <= end_time)
            ]

            total_amount = window["amount"].sum()

            # Check detection conditions
            if (
                total_amount >= threshold
                and len(window) >= min_transactions
            ):
                findings.append({
                    "pattern": "transaction_structuring",
                    "account": account,
                    "transaction_ids": window["id"].tolist(),
                    "transaction_count": len(window),
                    "total_amount": float(total_amount),
                    "window_minutes": window_minutes
                })

    return findings
