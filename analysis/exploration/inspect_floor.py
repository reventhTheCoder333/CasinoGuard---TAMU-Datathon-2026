import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

files = {
    "floor_locations": "data/2_machine_decision/floor_locations.csv",
    "zone_traffic": "data/4_context/zone_traffic_hourly.csv.gz"
}

for name, path in files.items():
    df = pd.read_csv(path)

    print(f"\n{'=' * 50}")
    print(name.upper())
    print("Rows:", len(df))
    print("Columns:", df.columns.tolist())

    print("\nSample:")
    print(df.head(5).to_string(index=False))

    print("\nMissing values:")
    print(df.isna().sum().to_string())
