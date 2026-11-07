import os as _os
from pathlib import Path as _Path

# Run relative to the repository root, whatever the current directory is.
_os.chdir(_Path(__file__).resolve().parents[2])


import pandas as pd

files = {
    "operations": "data/2_machine_decision/operations.csv",
    "machines": "data/2_machine_decision/machines.csv",
    "cost_rules": "data/2_machine_decision/cost_rules.csv",
    "action_catalog": "data/2_machine_decision/action_catalog.csv"
}

for name, path in files.items():
    df = pd.read_csv(path)

    print("\n" + "=" * 60)
    print(name.upper())
    print("=" * 60)

    print("Rows:", len(df))
    print("Columns:", df.columns.tolist())

    print("\nSample:")
    print(df.head(8).to_string(index=False))

    print("\nMissing values:")
    print(df.isna().sum().to_string())
    
    if name == "operations":
        print("\nEVENT TYPES:")
        print(df["event_type"].value_counts(dropna=False))

    if name == "cost_rules":
        print("\nCOST RULE CATEGORIES:")
        for col in df.select_dtypes(include="object").columns:
            print(f"\n{col}:")
            print(df[col].value_counts().head(20).to_string())

    if name == "action_catalog":
        print("\nACTION CATEGORIES:")
        for col in df.select_dtypes(include="object").columns:
            print(f"\n{col}:")
            print(df[col].value_counts().head(20).to_string())
import pandas as pd

files = {
    "OPERATIONS": "data/2_machine_decision/operations.csv",
    "MACHINES": "data/2_machine_decision/machines.csv",
    "COST_RULES": "data/2_machine_decision/cost_rules.csv"
}

for name, path in files.items():
    df = pd.read_csv(path)

    print("\n" + "=" * 60)
    print(name)
    print("=" * 60)

    print("Rows:", len(df))
    print("Columns:", df.columns.tolist())
    print(df.head(10).to_string(index=False))
    print("\nMissing values:")
    print(df.isna().sum().to_string())            
