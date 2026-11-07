# CASINOGUARD — TAMU Datathon 2026 · Dashboard Royale

Casino financial intelligence for **The Gilded Ace**, a fictional 300-machine casino (synthetic data). The project answers the challenge's questions — which machines truly underperform, how floor demand changed, what downtime cost, how player results are distributed, what the comp program cost — and recommends priced actions for a $100,000 budget, backed by a forecast validated on a time-based holdout.

## Repository layout

```
.
├── casinoguard/                 Interactive dashboard (React + TypeScript + Vite)
│   ├── pipeline/build_data.py   Raw tables → dashboard JSON, with 82 verification checks
│   ├── public/data/             Generated JSON consumed by the dashboard
│   ├── src/                     App source (pages, components, Q1 scoring engine)
│   ├── README.md                Setup, build and deployment
│   └── CALCULATIONS.md          Every formula, definition and investigated discrepancy
├── analysis/                    Exploratory Python analyses, one folder per question
│   ├── q1_machine_performance/  Scripts + outputs/ (bottom-10 candidate ranking)
│   ├── q2_floor_demand/         Scripts + outputs/ (zone, theme, traffic, hourly demand)
│   ├── q3_maintenance/          Scripts + outputs/ (downtime, response, exposure)
│   ├── q4_player_financials/    Scripts + outputs/ (player net, concentration, Gini)
│   ├── q5_loyalty/              Comp cost, ledger and tier analysis
│   └── exploration/             Initial data inspection scripts
├── data/                        Challenge datasets (release 0.9.0-draft; .parquet and .csv.gz)
├── reference/                   Challenge data dictionary, dataset reference, sources
├── scripts/                     Challenge data-verification scripts
├── docs/challenge/              Challenge brief: participant guide, original README, example layout
└── .github/workflows/           GitHub Pages deployment for the dashboard
```

## Quick start

Run the dashboard:

```bash
cd casinoguard
npm install
npm run dev
```

Regenerate the dashboard data from the raw tables (from the repository root):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r casinoguard/pipeline/requirements.txt
python casinoguard/pipeline/build_data.py
```

Run any exploratory analysis — see [analysis/README.md](analysis/README.md).

## Documentation

- [Dashboard setup and deployment](casinoguard/README.md)
- [Calculations and data sources](casinoguard/CALCULATIONS.md)
- [Analysis scripts and outputs](analysis/README.md)
- [Challenge participant guide](docs/challenge/GUIDE.md) · [data dictionary](reference/DATA_DICTIONARY.md)

The casino and its people are fictional; all data is synthetic except `data/4_context/real_sources`. Challenge materials are MIT-licensed by the organizers (see [LICENSE](LICENSE)).
