import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

files = {
    "Machine performance": "data/1_prepared_views/prepared_daily_view.csv",
    "Player performance": "data/1_prepared_views/player_period.csv",
    "Property performance": "data/1_prepared_views/property_day.csv",
    "Operations": "data/2_machine_decision/operations.csv",
    "Loyalty": "data/3_guests/loyalty_ledger.csv",
    "Sessions": "data/3_guests/sessions.csv",
}

for name, path in files.items():
    print("\n" + "=" * 55)
    print(name)

    df = pd.read_csv(path)

    print("Rows:", len(df))
    print("Columns:", len(df.columns))
    print("Missing values:", df.isna().sum().sum())
    print("Duplicate rows:", df.duplicated().sum())

    print("Date range:")
    for col in ["gaming_date", "period_month", "event_at_utc"]:
        if col in df.columns:
            print(df[col].min(), "to", df[col].max())
            break
