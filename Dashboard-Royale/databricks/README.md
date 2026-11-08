# Databricks notebook: CASINOGUARD_AML

`CASINOGUARD_AML.ipynb` is an unmodified export of the Databricks notebook that runs the anti-money-laundering (AML) detection pipeline used by this submission's **CASINOGUARD** application. It runs as a Databricks Job on serverless compute.

## What it does

The notebook is a medallion pipeline (bronze → silver → gold) over synthetic casino transactions:

| Stage | Cells | Output tables (`workspace.default`) |
|---|---|---|
| Ingest | Read `transactions.csv` and `accounts.csv` from the Unity Catalog volume `/Volumes/workspace/default/casinoguard_data/` | `transactions_bronze`, `accounts_bronze` |
| Clean | Cast amounts and timestamps; drop rows without them | `transactions_silver`, `accounts_silver` |
| Detect | Five AML detectors, written in PySpark | `structuring_alerts_gold`, `transaction_chains_gold`, `rapid_cashouts_gold`, `circular_transactions_gold`, `unusual_volume_gold` |
| Combine | One row per alert, with evidence and the thresholds used | `aml_alerts_gold` |

The five detectors and their thresholds, as recorded in `aml_alerts_gold.thresholds_json`:

| Detector | Flags | Thresholds |
|---|---|---|
| Transaction structuring | Several funding transactions under $10,000 that together reach it | $10,000 within 60 minutes, at least 3 transactions; excludes `CASINO` and wagers |
| Suspicious chains | Similar amounts passed quickly along a line of accounts | 3–5 hops within 15 minutes, amounts within 80% of each other |
| Rapid cash-outs | Most of a deposit withdrawn soon after, with little play | ≥ 80% withdrawn and ≤ 20% wagered within 60 minutes |
| Unusual volume | A day's transaction count far above the account's history | z-score ≥ 3 with at least 7 days of history |
| Circular transactions | Funds that loop back to the first account | Loops of 3–6 accounts |

Multiple-account activity is intentionally not part of this pipeline.

The saved cell outputs are from a run on the 49-transaction synthetic seed data, which produced one alert per detector (5 in total).

## How it relates to Dashboard Royale

This notebook is **not** part of Dashboard Royale's Q1–Q6 analysis. Those findings come from the challenge datasets in `Dashboard-Royale/data/`, processed by `Dashboard-Royale/casinoguard/pipeline/build_data.py`.

The connection is through the **Check AML** button in the Dashboard Royale dashboard, which opens the CASINOGUARD application (`CASINOGUARD/` in this repository). In Databricks mode, CASINOGUARD reads its alerts from the `aml_alerts_gold` table that this notebook writes, and its **Simulate data** button uploads new CSV files to the volume and runs this notebook as a Job. See [CASINOGUARD/docs/DATABRICKS_SETUP.md](../../CASINOGUARD/docs/DATABRICKS_SETUP.md).

## Running it

1. Import `CASINOGUARD_AML.ipynb` into a Databricks workspace that has Unity Catalog and the `workspace.default` schema.
2. Upload `transactions.csv` and `accounts.csv` to a volume at `/Volumes/workspace/default/casinoguard_data/`. CASINOGUARD's generator produces files in this format.
3. Run all cells, or create a Job with a single notebook task. CASINOGUARD's Simulate data feature expects a Job ID in its `.env` (`DATABRICKS_PIPELINE_JOB_ID`).

The notebook contains no credentials. It uses the workspace's own Spark session, so no tokens or connection strings are needed.

## Data

All data in and produced by this notebook is synthetic. The account records in the saved outputs (for example `linka@example.com`, `555-1111`, `CARD-101`) are made-up test values, not real people.
