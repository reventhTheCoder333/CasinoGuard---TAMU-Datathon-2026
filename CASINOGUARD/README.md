# CASINOGUARD

A real-time casino financial intelligence demo. Six detectors analyse a stream of transactions and raise explainable alerts on a live dashboard with an interactive network graph.

> **All seeded and simulated data is synthetic.** It doesn't describe real people or transactions.
>
> **Alerts are suspicious indicators, not proof of wrongdoing.** A qualified analyst must review each one before any action is taken.
>
> This is a demo. It has no authentication and keeps everything in memory, so don't load real customer data into it.

## Quick start

You need Python 3.11+ and Node 20+. Run these from the repository root.

Install the backend:

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r backend/requirements-dev.txt
```

Install the frontend:

```bash
npm --prefix frontend install
```

Start the API in one terminal:

```bash
.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

Start the dashboard in a second terminal, then open http://localhost:5173:

```bash
npm --prefix frontend run dev
```

### One-port mode

Build the dashboard and the API serves it at http://localhost:8000. Restart the API after building, because it only looks for the build at startup.

```bash
npm --prefix frontend run build
```

For an explanation of everything on the screen, see the [dashboard guide](docs/DASHBOARD_GUIDE.md).

## Databricks mode (Databricks as the source of truth)

CASINOGUARD can read detection results from Databricks instead of running its own detectors:

```
Databricks tables ──SQL Statement API──> FastAPI (read-only) ──REST + WebSocket──> Dashboard
```

- **FastAPI never runs the detectors in this mode.** Each alert is one row of the alerts table, and its evidence comes from that row's `evidence_json`. FastAPI only adds presentation on top: titles, review priority and the investigation layout.
- **The browser never talks to Databricks.** Only the backend holds the token, which never appears in any API response or error message.
- **It's read-only.** Submitting transactions or accounts, the simulator and the Databricks export all return 409.

| Table | Used for |
|---|---|
| `workspace.default.aml_alerts_gold` | Alerts and evidence: `alert_id`, `pattern`, `accounts`, `transaction_ids`, `total_amount`, `evidence_json`, `detected_at` |
| `workspace.default.transactions_silver` | Transaction timelines, the graph and the transaction stream |
| `workspace.default.accounts_silver` | Account profiles |

To set it up, add these to `.env` in the repository root. The file is gitignored; never commit it.

```
CASINOGUARD_DATA_SOURCE=databricks
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<personal access token>
```

- **Warehouse:** set `DATABRICKS_WAREHOUSE_ID` to choose one. Otherwise the workspace's warehouse is found automatically.
- **Tables:** these can be overridden too; see `.env.example`.
- **When data loads:** at startup and when you click **Refresh from Databricks**. Startup doesn't wait for a stopped warehouse; the dashboard shows a loading state instead.
- **Automatic polling is off by default** because every refresh queries the warehouse and stops it auto-stopping. Set `DATABRICKS_REFRESH_SECONDS` (minimum 15) to turn it on. When data changes, every open dashboard reloads.
- **Failed refreshes:** the last good data stays on screen, and a red banner shows the error.
- **Rows that can't be read:** rows with an unknown pattern or invalid evidence are skipped and listed in the data source panel.

- **Thresholds:** "Why this was flagged" uses the thresholds the pipeline records in `thresholds_json`. Rows without them fall back to CASINOGUARD's reference values, and the panel says so.
- **Five detectors:** multiple-account activity is excluded from Databricks mode. It's never requested or displayed, and only five detector filters appear.
- **Simulate data:** choose **Full simulation** (all five patterns) or **Individual** (one detector's pattern). It generates a fresh day of background activity with only those patterns embedded, uploads it, runs the Databricks pipeline job (all five detectors run every time), loads the results, and compares what Databricks detected with what was embedded. It needs a Databricks job; see [Databricks setup](docs/DATABRICKS_SETUP.md).

 Remove `CASINOGUARD_DATA_SOURCE` or set it to `local` to switch back to local detection and the simulator.

## Demo script (about 3 minutes)

1. **Starting point.** The dashboard opens with six alerts, one from each detector, all raised by running the detectors on the seed data. Point out the **Synthetic data** badge and the "not proof" notice in the header.
2. **Explore the network.** Drag nodes, scroll to zoom, and click a node or link for details. Ring colours show which detector flagged an account, and dashed links show shared identifiers. **Hide casino** removes the hub so peer-to-peer patterns stand out.
3. **Start normal traffic.** Turn on **Normal background traffic**. Transactions stream in and particles move along the graph, but no alerts appear, which shows ordinary play isn't flagged.
4. **Run the scenarios.** Click **Run all six scenarios**. It takes about 30 seconds. Watch for:
   - new alerts appearing with pulsing rings on the accounts involved
   - the chain alert growing from 3 to 4 hops as an update, not a second alert
   - **Run results** listing the alerts the detectors actually raised
5. **Investigate.** Click any alert. The graph focuses on its accounts and the panel shows:
   - each condition tested, with the observed value against its limit
   - the transaction timeline and the accounts involved
   - possible innocent explanations and suggested next steps
   - the raw detector output
6. **Submit your own transaction.** Send one through the API and it appears live:

   ```bash
   curl -X POST http://localhost:8000/api/transactions -H 'Content-Type: application/json' -d '{"id":"DEMO-1","account":"DEMO_A","from":"DEMO_A","to":"CASINO","amount":250,"timestamp":"2026-01-01T12:00:00Z","type":"deposit"}'
   ```

7. **Reset.** **Reset demo** restores the seed data and discards everything added since.

## How it works

```
Simulator ─┐
           ├─> pipeline ─> DetectionService ─> six detectors ─> consolidated alerts
POST /api ─┘                                                          │
                                                 WebSocket /ws <──────┤
                                                 REST /api     <──────┘
```

- **Detectors decide.** Simulator scenarios only generate transactions and go through the same pipeline as API submissions. No alert text or count is hardcoded. Descriptions are generated from each finding's values, and thresholds are read from the detector's function signature.
- **Alerts are consolidated.** Detectors re-report everything on each run, often as overlapping windows. `DetectionService` gives alerts stable IDs and folds growing evidence into one alert with a revision number. Alerts stay on record even if a later run stops reporting them.
- **Priority is for review order only.** High and medium come from simple published rules, and each alert states the reason. Priority isn't a risk score or a measure of guilt.

| Detector | Flags | Default limits |
|---|---|---|
| Suspicious chains | Similar amounts moving through a line of accounts, in time order | 3–5 hops, within 15 min, amounts within 80% |
| Structuring | Sub-threshold funding transactions that together cross the threshold | $10,000 total, 3+ transactions, 60 min |
| Rapid cash-outs | Most of a deposit withdrawn with little play | 80%+ withdrawn, 20% or less wagered, 60 min |
| Unusual volume | Daily count far above the account's history | z-score of 3+, 7+ days of history |
| Circular flows | Transfers that loop back to the origin | 3–6 accounts, no time limit |
| Multiple accounts | Accounts sharing a phone, email or payment card | 2+ accounts |

### Project layout

| Path | Contents |
|---|---|
| `detectors/`, `engine/` | The six detectors and the runner |
| `data/transactions.py` | Synthetic seed data |
| `backend/services/` | Alert consolidation, investigation details, graph, simulator, pipeline |
| `backend/api/` | REST routes, request validation, WebSocket |
| `backend/integrations/` | Databricks, SerpApi and Tableau interfaces |
| `frontend/` | React dashboard |
| `tests/`, `frontend/src/state.test.ts` | Backend and frontend tests |

## API

Interactive docs are at http://localhost:8000/docs.

| Method and path | Purpose |
|---|---|
| `GET /health` | Status, including any detector failures |
| `GET /api/summary` | Dashboard totals |
| `GET /api/alerts` | Alerts; filter with `?detector=` and `?severity=` |
| `GET /api/alerts/{id}` | Full investigation for an alert |
| `GET /api/detect` | Full detection report |
| `GET /api/detectors` | The six detectors and their thresholds |
| `GET /api/graph` | Network nodes and edges |
| `GET`, `POST /api/transactions` | List (`?limit=`, `?account=`) or submit transactions |
| `GET`, `POST /api/accounts` | List or register account profiles |
| `GET /api/simulator` | Scenarios and run status |
| `POST /api/simulator/run` | Run a scenario: `{"scenario": "chain"}` or `"all"` |
| `POST /api/simulator/traffic` | Background traffic: `{"enabled": true}` |
| `POST /api/simulator/stop`, `/reset` | Stop runs, or restore the seed data |
| `GET /api/source` | Data source and its status |
| `POST /api/source/refresh` | Reload from Databricks (Databricks mode only) |
| `POST /api/databricks/simulate` | `{"scenario": "full"}` or one detector's scenario; runs the Databricks pipeline job, then reloads |
| `GET /api/databricks/simulation` | Progress of the current or last simulation |
| `GET /api/integrations` | Integration status; never includes secrets |
| `GET /api/export/alerts.csv`, `transactions.csv` | CSV extracts |

**WebSocket `/ws`** sends JSON messages of the form `{"event": ..., "data": ...}`. The events are `connected`, `transaction_received`, `account_registered`, `new_alert`, `alert_updated`, `summary`, `simulator_status` and `state_reset`. Send `ping` to receive `pong`.

## Integrations

Everything runs without credentials. An integration makes no network calls until it's configured. To configure one, copy `.env.example` to `.env` and fill in its values.

| Integration | Without credentials | With credentials |
|---|---|---|
| Databricks (source) | Local detection is used | Reads alerts from Databricks; see Databricks mode above |
| Databricks (export) | `POST /api/integrations/databricks/export` returns 503 | Local mode only: inserts alerts into `DATABRICKS_EXPORT_TABLE` |
| SerpApi | `GET /api/integrations/serpapi/search?q=` returns 503 | Runs a public-web lookup that an analyst typed; results are marked unverified |
| Tableau | CSV exports work | Publishing isn't implemented; connect Tableau to the CSV extracts |

Databricks mode has been run against a real workspace. The Databricks export and SerpApi clients are tested with mocked HTTP only, so test them with real credentials before relying on them.

## Tests

```bash
.venv/bin/python -m pytest -q
```

```bash
npm --prefix frontend test
```

## Known limitations

- Data is in memory and is lost on restart.
- Detection re-runs over all history for each transaction. Ingest takes about 80 ms at 670 transactions and grows roughly in line with the total, so the store is capped at 5,000 transactions. After that, new transactions return 503 until you reset.
- There's no authentication, and `/api/accounts` returns identifiers in full.
- The thresholds are illustrative defaults and aren't tuned or validated against real data or any specific regulation.
- Simulated activity in the volume scenario is backdated to build a history, and scenario timestamps are spaced in simulated minutes, so they don't match when the events arrived.
