import pandas as pd
import glob
import os

files = glob.glob("**/*.csv", recursive=True)
files += glob.glob("**/*.csv.gz", recursive=True)

for file in sorted(set(files)):
    try:
        df = pd.read_csv(file, nrows=5)

        print("\n" + "=" * 60)
        print("FILE:", file)
        print("COLUMNS:", list(df.columns))
        print("SAMPLE:")
        print(df.head(2).to_string(index=False))

    except Exception as e:
        print("ERROR:", file, e)