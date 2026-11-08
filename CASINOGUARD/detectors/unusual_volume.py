import pandas as pd


def detect_unusual_volume(
    transactions,
    z_score_threshold=3,
    min_history_days=7
):
    if not transactions:
        return []

    df = pd.DataFrame(transactions)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601")
    df["date"] = df["timestamp"].dt.date

    daily_counts = (
        df.groupby(["account", "date"])
        .size()
        .reset_index(name="transaction_count")
    )

    findings = []

    for account, group in daily_counts.groupby("account"):
        group = group.sort_values("date").reset_index(drop=True)

        if len(group) <= min_history_days:
            continue

        for i in range(min_history_days, len(group)):
            history = group.iloc[:i]["transaction_count"]
            current_count = group.iloc[i]["transaction_count"]

            average = history.mean()
            std_dev = history.std()

            if std_dev == 0:
                if current_count <= average:
                    continue

                # Use a finite score for JSON compatibility
                z_score = z_score_threshold + 1

            else:
                z_score = (current_count - average) / std_dev

            if z_score >= z_score_threshold:
                findings.append({
                    "pattern": "unusual_transaction_volume",
                    "account": account,
                    "date": str(group.iloc[i]["date"]),
                    "transaction_count": int(current_count),
                    "historical_average": round(float(average), 2),
                    "historical_std_dev": round(float(std_dev), 2),
                    "z_score": round(float(z_score), 2)
                })

    return findings