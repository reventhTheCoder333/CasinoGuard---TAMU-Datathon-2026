# Dashboard Royale + CASINOGUARD

TAMU Datathon 2026 submission: two independent applications in one repository.

| Project | Folder | What it does |
|---|---|---|
| **Dashboard Royale** (main project) | [`Dashboard-Royale/`](Dashboard-Royale/README.md) | Casino operations analysis for The Gilded Ace, a fictional 300-machine casino. It covers machine performance, floor demand, maintenance downtime, player financials and loyalty costs, and recommends actions for a $100,000 budget. Its interactive dashboard is in `Dashboard-Royale/casinoguard/`. |
| **CASINOGUARD** (AML platform) | [`CASINOGUARD/`](CASINOGUARD/README.md) | Anti-money-laundering investigation platform. Five detectors (structuring, transaction chains, rapid cash-outs, unusual volume, circular transactions) flag suspicious activity on a live dashboard with a transaction network graph and investigation details. Detection can run locally or in a Databricks pipeline. |

> **Naming note:** Dashboard Royale's dashboard folder is also called `casinoguard/`. That's the analysis dashboard, not the AML platform; the AML platform is the top-level `CASINOGUARD/` folder.

All data is synthetic except the public context data in `Dashboard-Royale/data/4_context/real_sources`. AML alerts are suspicious indicators, not proof of wrongdoing.

## How they work together

Dashboard Royale is the main application. Its sidebar has a **Check AML** button that opens the CASINOGUARD frontend in a new tab. The two apps share no code, dependencies or backend, and each runs on its own.

```
Dashboard Royale dashboard (React + Vite, :5179)
        │  "Check AML" link (VITE_AML_URL)
        ▼
CASINOGUARD frontend (React + Vite, :5173) ──REST + WebSocket──> CASINOGUARD API (FastAPI, :8000)
                                                                     │  optional
                                                                     ▼
                                     Databricks: CSV → bronze → silver → 5 detectors → aml_alerts_gold
```

## Technology

| | Dashboard Royale | CASINOGUARD |
|---|---|---|
| Frontend | React, TypeScript, Vite | React, TypeScript, Vite, react-force-graph |
| Backend and data | Python and pandas analyses; pre-built JSON data | Python, FastAPI, WebSockets, NetworkX, pandas |
| Pipeline | `casinoguard/pipeline/build_data.py` | Databricks Jobs, Delta tables, SQL Statement API |

## Repository structure

```
├── Dashboard-Royale/   analysis/, data/, reference/, scripts/, docs/, casinoguard/ (dashboard), README.md
├── CASINOGUARD/        backend/, detectors/, engine/, data/, frontend/, tests/, docs/, README.md
├── README.md
└── .gitignore
```

## Running the demo

Requirements: Node 20+ and Python 3.11+. Use three terminals, starting each from the repository root.

**1. CASINOGUARD API**

```bash
cd CASINOGUARD
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --port 8000
```

**2. CASINOGUARD frontend** (http://localhost:5173)

```bash
cd CASINOGUARD/frontend
npm install
npm run dev
```

**3. Dashboard Royale dashboard** (http://localhost:5179)

```bash
cd Dashboard-Royale/casinoguard
npm install
npm run dev
```

Open http://localhost:5179 and click **Check AML** in the sidebar to open CASINOGUARD. To point the button somewhere else, such as a hosted CASINOGUARD, copy `Dashboard-Royale/casinoguard/.env.example` to `.env` and set `VITE_AML_URL`.

## Databricks pipeline (CASINOGUARD)

By default CASINOGUARD runs its detectors locally on synthetic data, with a built-in simulator. In Databricks mode, the API reads detection results from Databricks instead, and its **Simulate data** button runs this pipeline:

1. The API generates a day of synthetic activity with the chosen suspicious pattern(s) embedded, and uploads it as CSV files to a Unity Catalog volume.
2. It triggers the Databricks job, which runs the `CASINOGUARD_AML` notebook: CSV → bronze → silver → the five detectors → `aml_alerts_gold`, with evidence and thresholds.
3. The API checks the results are fresh, loads them, and updates every open dashboard.

Credentials stay on the API server and are never sent to the browser. Setup: copy `CASINOGUARD/.env.example` to `CASINOGUARD/.env` and fill in the values; see [CASINOGUARD/docs/DATABRICKS_SETUP.md](CASINOGUARD/docs/DATABRICKS_SETUP.md). The notebook itself lives in the Databricks workspace.

## More documentation

- [Dashboard Royale README](Dashboard-Royale/README.md) · [dashboard setup](Dashboard-Royale/casinoguard/README.md) · [calculations](Dashboard-Royale/casinoguard/CALCULATIONS.md)
- [CASINOGUARD README](CASINOGUARD/README.md) · [dashboard guide](CASINOGUARD/docs/DASHBOARD_GUIDE.md) · [Databricks setup](CASINOGUARD/docs/DATABRICKS_SETUP.md)
