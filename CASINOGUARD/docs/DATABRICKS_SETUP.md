# Databricks setup for "Simulate data"

This guide covers what to set up in Databricks so the dashboard's **Simulate data** button can run your pipeline end to end.

## What happens when you click Simulate data

```
Dashboard ──POST /api/databricks/simulate──> FastAPI
  1. Generate data      data/scenarios.py: a day of ordinary activity with the chosen
                        pattern(s) embedded (Full simulation = all five)
  2. Upload             /Volumes/workspace/default/casinoguard_data/transactions.csv and accounts.csv
  3. Run the job        CASINOGUARD_AML notebook:
                        CSV → bronze → silver → five detectors → aml_alerts_gold, with thresholds_json
  4. Check freshness    bronze and silver row counts match the upload, aml_alerts_gold was
                        rewritten after the run started, and no gold row is older than that
  5. Load results       FastAPI reads aml_alerts_gold, transactions_silver and accounts_silver,
                        then compares what Databricks detected with what was embedded
Dashboard <──WebSocket: progress, then a full reload── FastAPI
```

- **Detection only runs in Databricks.** FastAPI never runs the detectors in this mode.
- **Credentials stay on the API server.** The browser only talks to FastAPI.
- **Why FastAPI uploads CSVs rather than writing bronze directly:** the notebook's first cells load `transactions_bronze` and `accounts_bronze` from these two CSV files with `mode("overwrite")`. Anything written straight to bronze would be replaced by whatever CSVs were already there. Uploading the CSVs lets the notebook's own ingestion fill bronze, and FastAPI then checks that bronze holds exactly the uploaded rows.

## 1. Fix the CASINOGUARD_AML notebook

The notebook works when you run its cells by hand, but a job runs every cell from top to bottom, and some cells would make the run fail.

1. **Fix the cell that reads `transaction_structuring_gold`.** That table doesn't exist; the structuring table is `structuring_alerts_gold`. The cell is the first of the two "print each table's schema" cells near the end. Delete it, or change the name. The second copy of that cell already uses the right name.
2. **Remove the multiple-account detection.** Multiple-account activity is excluded from this pipeline, so delete:
   - the cells that compute and save `multiple_accounts_gold`
   - the cell listing the gold tables that includes `multiple_accounts_gold`
   - the **older** `normalize_alerts(...)` cell that builds `aml_alerts_gold` from six tables including `multiple_accounts_gold`. The later cell, "Combine all five algorithms", replaces it.

   **Keep the cell that builds `accounts_silver` from `accounts_bronze`.** The dashboard reads account profiles from it.
3. **Recommended: write `aml_alerts_gold` once.** At the moment, "Combine all five algorithms" writes the table and the next cell rewrites it to add `thresholds_json`. If someone reads the table in between, they see alerts without thresholds. Move the thresholds `withColumn` into the first cell and drop the second write.
4. **Check where tables are written.** The notebook uses short names such as `saveAsTable("aml_alerts_gold")`. These must resolve to `workspace.default`, which is where the API reads from. If the job's default catalog or schema differs, add `spark.sql("USE workspace.default")` at the top, or use full names.

Run the notebook once from top to bottom to confirm it finishes. Then check that `aml_alerts_gold` has rows for exactly the five patterns, each with `thresholds_json`.

## 2. Create the job

1. In Databricks, go to **Jobs & Pipelines → Create → Job**.
2. Give it a name, for example `casinoguard-aml-pipeline`.
3. Set up the task:
   - **Type:** Notebook
   - **Source:** Workspace
   - **Path:** `/Users/<your user>/CASINOGUARD_AML`
   - **Compute:** Serverless
4. In job settings:
   - **Maximum concurrent runs:** 1, so two simulations can't overwrite each other's data.
   - **Timeout:** for example 30 minutes. FastAPI also cancels a run after `DATABRICKS_JOB_TIMEOUT_SECONDS`, which defaults to 1800.
   - **Schedule:** none. FastAPI triggers the job.
5. Save it and copy the **Job ID** from the job's page.

## 3. Permissions for the token FastAPI uses

| Resource | Permission | Why |
|---|---|---|
| SQL warehouse | Can use | Reading tables and freshness checks |
| Volume `workspace.default.casinoguard_data` | READ VOLUME, WRITE VOLUME | Uploading the CSVs |
| Tables in `workspace.default` | SELECT | Reading bronze, silver and gold |
| The job | Can manage run | Starting, checking and cancelling runs |

The job itself runs with its owner's permissions, which need to include writing the bronze, silver and gold tables.

**Use a service principal rather than a personal token.** A personal token gives FastAPI everything your account can do. **Rotate the token that was shared in chat** in either case.

## 4. Configure FastAPI

Add these to `.env` on the API server, then restart the API:

```
CASINOGUARD_DATA_SOURCE=databricks
DATABRICKS_HOST=https://dbc-41cd4e46-f1bd.cloud.databricks.com
DATABRICKS_TOKEN=<token>
DATABRICKS_PIPELINE_JOB_ID=<job id from step 2>
```

These are optional, and the defaults match your workspace:

| Variable | Default |
|---|---|
| `DATABRICKS_WAREHOUSE_ID` | Found automatically |
| `DATABRICKS_UPLOAD_VOLUME` | `/Volumes/workspace/default/casinoguard_data` |
| `DATABRICKS_TRANSACTIONS_BRONZE_TABLE` | `workspace.default.transactions_bronze` |
| `DATABRICKS_ACCOUNTS_BRONZE_TABLE` | `workspace.default.accounts_bronze` |
| `DATABRICKS_ALERTS_SOURCE_TABLE` | `workspace.default.aml_alerts_gold` |
| `DATABRICKS_TRANSACTIONS_TABLE` | `workspace.default.transactions_silver` |
| `DATABRICKS_ACCOUNTS_TABLE` | `workspace.default.accounts_silver` |
| `DATABRICKS_JOB_TIMEOUT_SECONDS` | `1800` |

Until `DATABRICKS_PIPELINE_JOB_ID` is set, **Simulate data** is disabled and the panel explains why. Everything else in Databricks mode still works.

## How failures are handled

| Situation | What you see |
|---|---|
| The job is already running in Databricks | The simulation stops before uploading, so a running pipeline is never interrupted. |
| The job fails or is cancelled | The failed step is marked ✕, and Databricks' own error message and a link to the job run are shown. |
| The job takes longer than the timeout | FastAPI cancels the run and reports it. |
| The job succeeds but bronze or silver row counts don't match the upload | Reported as a failure, because the job may not have used this upload. |
| The job succeeds but `aml_alerts_gold` wasn't rewritten, or has rows older than the run | Reported as stale results. |
| Any failure | The previous results stay on screen, and a red banner says they may be out of date. |
| While the job is running | A blue banner says the results on screen are the previous ones. |

Only one simulation runs at a time. A second click returns "already running".

## Scenarios

The dashboard offers **Full simulation** (all five patterns) or **Individual** (one pattern). The API takes the same choice:

```
POST /api/databricks/simulate
{"scenario": "full" | "transaction_structuring" | "transaction_chains" | "rapid_cashouts" | "unusual_volume" | "circular_transactions",
 "seed": <optional integer, to repeat a run exactly>}
```

The pipeline, the job and the detectors are the same in every mode. **All five detectors run on every simulation**, and only the uploaded data changes.

### What gets generated

Each run creates a fresh, random day of activity dated the previous UTC day, so no timestamp is ever in the future. The random seed is shown in the dashboard and can be passed back to repeat a run.

**Background activity** is roughly 330–530 transactions from about 30 players: deposits at the casino or a cage, wagers, small withdrawals, a few regulars with earlier visits, and occasional small transfers between players. It's shaped so that none of the five detectors should fire on it:

| Detector | Why the background stays below it |
|---|---|
| Structuring | One small deposit per session, with sessions at least 90 minutes apart |
| Chains | Players who send transfers never receive them, so no 3-hop path can form |
| Rapid cash-outs | Sessions wager 40–90% of a deposit and withdraw at most 35% |
| Unusual volume | Regulars have at most 5 earlier active days; the detector needs 7 |
| Circular | Players who send transfers never receive them, so no loop can form |

**Embedded patterns**, sized to match how the Spark detectors behave:

| Pattern | What's embedded |
|---|---|
| Structuring | Exactly 3 deposits of $3,400–$4,900 at different cages within an hour. The pipeline's rolling window would report a fourth deposit as extra overlapping alerts. |
| Chain | 4 accounts, 3 transfers 3–6 minutes apart, each 96–99% of the previous. The pipeline also reports longer chains as their shorter sub-chains. |
| Rapid cash-out | A $5,000–$12,000 deposit, a 1–5% wager, and an 85–97% withdrawal within 30 minutes. |
| Unusual volume | 7 days of 2–3 transactions a day, then 16–24 in one day. |
| Circular | 3 accounts passing similar amounts in a loop, with 20–45 minutes between transfers so it isn't also a chain. |

### Embedded vs detected

After loading, FastAPI compares each embedded pattern with the alerts Databricks returned, matching on pattern and accounts. The dashboard shows ✓ for each one detected, ✕ for any missed, and ! for any alert that wasn't embedded. The alerts on screen are always exactly what Databricks returned; the comparison only checks the run.

## Things to know

- **Every run uploads new data.** Uploading replaces both CSV files in the volume each time.
- **Local mode is unaffected.** With `CASINOGUARD_DATA_SOURCE=local`, the original simulator and all six local detectors work as before. The Databricks endpoints return 409 in that mode.

## Embedded dashboard

The **Databricks dashboard** page embeds the published AI/BI dashboard with
`@databricks/aibi-client`, using Databricks' external-user embedding flow. The
browser only ever receives a short-lived token scoped to that one dashboard.

1. In the workspace, go to **Settings → Identity and access → Service principals**,
   create a service principal, and select **Databricks SQL access** and **Workspace access**.
2. On its page, generate an **OAuth secret** and copy the client ID and secret.
3. Open the published dashboard, click **Share**, and give the service principal **CAN RUN**.
   If the dashboard uses individual data permissions, also grant it `SELECT` on the tables it reads.
4. In **Settings → Security → Embed dashboards**, allow embedding and approve
   `http://localhost:5173` (and `http://localhost:8000` for the one-port build).
5. Set `DATABRICKS_WORKSPACE_ID`, `DATABRICKS_DASHBOARD_ID`, `DATABRICKS_SP_CLIENT_ID`
   and `DATABRICKS_SP_CLIENT_SECRET` in `.env`, then restart the API.

`POST /api/databricks/dashboard/token` performs the three-step exchange
(service principal token → dashboard `tokeninfo` → scoped token). The embed calls
it again before the token expires, so long sessions keep working.
