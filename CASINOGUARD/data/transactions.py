
from datetime import datetime, timedelta


def generate_synthetic_data():
    transactions = []
    accounts = []

    def add_transaction(
        tx_id,
        account,
        sender,
        receiver,
        amount,
        timestamp,
        tx_type="transfer"
    ):
        transactions.append({
            "id": tx_id,
            "account": account,
            "from": sender,
            "to": receiver,
            "amount": amount,
            "timestamp": timestamp,
            "type": tx_type
        })

    # --------------------------------------------------
    # 1. NORMAL CASINO ACTIVITY
    # --------------------------------------------------

    add_transaction(
        "NORMAL001", "PLAYER001", "PLAYER001", "CASINO",
        200, "2026-11-05T09:00:00", "deposit"
    )

    add_transaction(
        "NORMAL002", "PLAYER001", "PLAYER001", "CASINO",
        50, "2026-11-05T09:10:00", "wager"
    )

    add_transaction(
        "NORMAL003", "PLAYER001", "CASINO", "PLAYER001",
        100, "2026-11-05T09:30:00", "withdrawal"
    )

    # --------------------------------------------------
    # 2. SUSPICIOUS TRANSACTION CHAIN
    # --------------------------------------------------

    add_transaction(
        "CHAIN001", "CHAIN_A", "CHAIN_A", "CHAIN_B",
        5000, "2026-11-05T10:00:00"
    )

    add_transaction(
        "CHAIN002", "CHAIN_B", "CHAIN_B", "CHAIN_C",
        4900, "2026-11-05T10:04:00"
    )

    add_transaction(
        "CHAIN003", "CHAIN_C", "CHAIN_C", "CHAIN_D",
        4800, "2026-11-05T10:08:00"
    )

    # --------------------------------------------------
    # 3. TRANSACTION STRUCTURING
    # --------------------------------------------------

    add_transaction(
        "STRUCT001", "STRUCT_A", "STRUCT_A", "CAGE001",
        4000, "2026-11-05T11:00:00", "deposit"
    )

    add_transaction(
        "STRUCT002", "STRUCT_A", "STRUCT_A", "CAGE002",
        3500, "2026-11-05T11:15:00", "deposit"
    )

    add_transaction(
        "STRUCT003", "STRUCT_A", "STRUCT_A", "CAGE003",
        3000, "2026-11-05T11:30:00", "deposit"
    )

    # --------------------------------------------------
    # 4. RAPID CASH-OUT
    # --------------------------------------------------

    add_transaction(
        "CASH001", "CASH_A", "CASH_A", "CASINO",
        9000, "2026-11-05T12:00:00", "deposit"
    )

    add_transaction(
        "CASH002", "CASH_A", "CASH_A", "CASINO",
        100, "2026-11-05T12:05:00", "wager"
    )

    add_transaction(
        "CASH003", "CASH_A", "CASINO", "CASH_A",
        8900, "2026-11-05T12:15:00", "withdrawal"
    )

    # --------------------------------------------------
    # 5. UNUSUAL TRANSACTION VOLUME
    # --------------------------------------------------

    historical_start = datetime(2026, 10, 29)

    # Seven historical days with two transactions per day
    for day in range(7):
        current_date = historical_start + timedelta(days=day)

        for j in range(2):
            timestamp = (
                current_date + timedelta(hours=10 + j)
            ).isoformat()

            add_transaction(
                f"VOLUME_HIST_{day}_{j}",
                "VOLUME_A",
                "VOLUME_A",
                "CASINO",
                100,
                timestamp
            )

    # Current day: 20 transactions
    current_date = datetime(2026, 11, 5)

    for j in range(20):
        timestamp = (
            current_date + timedelta(minutes=j * 2)
        ).isoformat()

        add_transaction(
            f"VOLUME_CURRENT_{j}",
            "VOLUME_A",
            "VOLUME_A",
            "CASINO",
            100,
            timestamp
        )

    # --------------------------------------------------
    # 6. CIRCULAR TRANSACTIONS
    # --------------------------------------------------

    add_transaction(
        "CIRCLE001", "CIRCLE_A", "CIRCLE_A", "CIRCLE_B",
        5000, "2026-11-05T13:00:00"
    )

    add_transaction(
        "CIRCLE002", "CIRCLE_B", "CIRCLE_B", "CIRCLE_C",
        4900, "2026-11-05T13:05:00"
    )

    add_transaction(
        "CIRCLE003", "CIRCLE_C", "CIRCLE_C", "CIRCLE_A",
        4800, "2026-11-05T13:10:00"
    )

    # --------------------------------------------------
    # 7. MULTIPLE-ACCOUNT ACTIVITY
    # --------------------------------------------------

    accounts = [
        {
            "account": "LINK_A",
            "phone": "555-1111",
            "email": "linka@example.com",
            "payment_card": "CARD-101"
        },
        {
            "account": "LINK_B",
            "phone": "555-1111",
            "email": "linkb@example.com",
            "payment_card": "CARD-101"
        },
        {
            "account": "LINK_C",
            "phone": "555-2222",
            "email": "linkc@example.com",
            "payment_card": "CARD-202"
        },
        {
            "account": "NORMAL_ACCOUNT",
            "phone": "555-3333",
            "email": "normal@example.com",
            "payment_card": "CARD-303"
        }
    ]

    return transactions, accounts
import pandas as pd

transactions, accounts = generate_synthetic_data()

pd.DataFrame(transactions).to_csv(
    "transactions.csv", index=False
)

pd.DataFrame(accounts).to_csv(
    "accounts.csv", index=False
)

print("Synthetic data generated successfully!")
