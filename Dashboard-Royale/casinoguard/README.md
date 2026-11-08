# CASINOGUARD

**Casino financial intelligence for The Gilded Ace** — an interactive dashboard for the TAMU Datathon *Dashboard Royale* challenge (fictional casino, synthetic data).

It answers the five analytical questions, recommends priced actions for the $100,000 budget, and validates a time-series forecast on a time-based holdout. Every number on screen is computed from the original tables by one reproducible pipeline, and the team's verified Q1–Q5 results are re-derived and asserted on every run (82/82 checks).

| Section | What judges can do |
| --- | --- |
| **Overview** | Seven headline KPIs with definitions, data-coverage meter, one-line answer per question, drill-through links |
| **Q1 Machine Performance** | Re-run the 60/40 percentile scoring for any period; filter by zone, config, manufacturer; click a machine for evidence (luck, availability, zone context, weekly history); compare with the manager's raw "bottom 10" |
| **Q2 Floor Demand** | Monthly zone trends for 5 metrics; first-vs-last-month comparison; drill into a zone → daily coin-in, foot traffic, banks, hourly profile; theme comparison; events |
| **Q3 Maintenance** | All 1,226 operations tickets; filters by category, manufacturer, zone, machine; downtime by month/hour/weekday; manufacturer reliability; estimated lost-play exposure per machine and ticket |
| **Q4 Player Financials** | Outcome split and reconciliation (gross losses − winnings = casino net); net-result distribution; concentration curves and Gini; tier/region/age segments; anonymised top-100 |
| **Q5 Loyalty** | Monthly cost and cost/theo; the May 1 redemption-pricing change by day, tier and benefit; points movement; tier transitions; three-source reconciliation |
| **Recommendations** | Three priced actions from `action_catalog` with cost formula, scenarios, break-even, uncertainty, measurement plan and evidence links; constraint checks; rejected options |
| **Forecast Model** | Two baselines vs two candidates on a May–June holdout; MAE, bootstrap CI, leakage controls, decision it informs |
| **Methodology & Evidence** | Per-question method cards, Claims & Evidence table with source inspection, all verification checks, provenance, AI disclosure |

A **global analysis period** (top bar) re-scopes every page; each panel has a **Source** button showing the dataset, fields and formula behind it; tables are searchable, sortable and export to CSV.

---

## Quick start

Requirements: Node 20+ and Python 3.11+ (only needed to regenerate data).

```bash
cd casinoguard
npm install
npm run dev            # http://localhost:5173
```

The generated data (`public/data/*.json`, ~2 MB) is committed, so the dashboard runs without Python.

### Regenerate the data from the raw tables

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r casinoguard/pipeline/requirements.txt
python casinoguard/pipeline/build_data.py
```

The pipeline reads `data/**` (plain `.csv`, or the original `.csv.gz` if unzipped files are absent), plus two team outputs it cross-checks or reuses (`analysis/q2_floor_demand/outputs/zone_demand_change.csv`, `analysis/q2_floor_demand/outputs/q2_hourly_demand_by_zone.csv`). It prints every verification check and **exits non-zero if any fails**. Runtime is a few seconds.

### Production build

```bash
cd casinoguard
npm run build          # type-checks, then writes dist/
npm run preview        # serves dist/ at http://localhost:4173
```

`dist/` is fully static (relative asset paths + hash routing), so it can be hosted from any path or opened from a file share behind any static server.

## Deployment

| Host | How |
| --- | --- |
| **GitHub Pages** | `.github/workflows/casinoguard-pages.yml` builds and deploys on push to `main`. In repo **Settings → Pages**, set Source to **GitHub Actions**. |
| **Netlify** | `casinoguard/netlify.toml` (base `casinoguard`, publish `dist`). Connect the repo, or `npx netlify deploy --dir=casinoguard/dist --prod`. |
| **Vercel** | Import the repo, set Root Directory to `casinoguard`; `vercel.json` supplies the build settings. |
| **Any static host / S3** | Upload the contents of `casinoguard/dist/`. |

Before submitting, open the deployed URL in a private window and click through each section.

## Project structure

```
casinoguard/
├── pipeline/build_data.py   # raw tables → public/data/*.json, with 82 verification checks
├── public/data/             # generated JSON (meta, overview, q1–q5, forecast, recommendations)
├── src/
│   ├── App.tsx              # shell: sidebar navigation, global period filter, routes
│   ├── lib/                 # data loading, period context, formatting, CSV export, Q1 scoring engine
│   ├── components/          # Panel (with Source provenance), KPI, DataTable, chart styling, controls
│   └── pages/               # Overview, Q1–Q5, Recommendations, Model, Methodology
└── CALCULATIONS.md          # formulas, definitions, data sources and known limitations
```

Stack: React 19 + TypeScript + Vite, Recharts for charts, no backend.

## Data integrity rules applied

- Ratios are ratio-of-sums, never averages of daily ratios.
- Gaming day = 6 am–6 am local; event timestamps are mapped with `calendar_day` UTC bounds; durations use UTC (DST-safe).
- Days a machine was not on the floor are excluded; offline traffic-counter hours are excluded, never zero-filled.
- Carded (player) and all-play (machine meter) totals are kept separate and labelled.
- Estimates (lost-play exposure, action benefits) are labelled as estimates with their assumptions.
- July 2025 is outside the window; ledger rows dated July in UTC belong to the June 30 gaming day except one partial-day row, which is excluded.
- No raw player IDs leave the pipeline; the top-100 table uses rank aliases.

See [CALCULATIONS.md](CALCULATIONS.md) for every formula and the discrepancies we investigated.

The casino and its people are fictional; all data is synthetic except `data/4_context/real_sources`.
