
import pandas as pd

files = [
    "data/2_machine_decision/operations.csv",
    "data/2_machine_decision/machine_day.csv",
    "data/2_machine_decision/machines.csv",
    "data/2_machine_decision/calendar_day.csv",
]

for file in files:
    print("\n" + "=" * 75)
    print("FILE:", file)
    print("=" * 75)

    df = pd.read_csv(file)

    print("Rows:", len(df))
    print("Columns:", df.columns.tolist())

    print("\nFirst 5 records:")
    print(df.head().to_string(index=False))

    print("\nData types:")
    print(df.dtypes)
