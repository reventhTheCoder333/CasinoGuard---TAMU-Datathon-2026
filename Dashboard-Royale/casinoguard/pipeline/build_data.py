"""
CASINOGUARD data pipeline.

Reads the original Dashboard Royale datasets (data/) and writes compact JSON
files consumed by the dashboard (casinoguard/public/data/).

Every number shown in the dashboard is produced here from the raw tables.
Verified headline results from the team's Q1-Q5 analyses are re-computed and
asserted (see VERIFIED below); the build fails loudly if they disagree.

Run from the repository root:
    .venv/bin/python casinoguard/pipeline/build_data.py
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "casinoguard" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

MONTHS = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]
START, END = "2025-01-01", "2025-06-30"

checks: list[dict] = []


def rd(path: Path, **kw) -> pd.DataFrame:
    """Read a CSV, falling back to the repository's original .csv.gz if the plain CSV is absent."""
    path = Path(path)
    if not path.exists():
        gz = path.with_name(path.name + ".gz") if path.suffix == ".csv" else path
        if gz.exists():
            path = gz
    return pd.read_csv(path, **kw)


def check(name: str, computed: float, expected: float, tol: float = 0.005, source: str = ""):
    ok = abs(computed - expected) <= tol
    checks.append({"name": name, "computed": computed, "expected": expected, "ok": bool(ok), "source": source})
    status = "OK " if ok else "FAIL"
    print(f"[{status}] {name}: computed={computed:,.4f} expected={expected:,.4f}")


def r2(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 2)


def r4(x):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), 4)


def clean(obj):
    """Recursively convert numpy/pandas types and NaN to JSON-safe values."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if obj is pd.NA:
        return None
    return obj


def records(df: pd.DataFrame, money4: tuple[str, ...] = ()) -> list[dict]:
    out = []
    for row in df.to_dict(orient="records"):
        rec = {}
        for k, v in row.items():
            if isinstance(v, float):
                rec[k] = r4(v) if k in money4 else (None if math.isnan(v) else round(v, 4))
            else:
                rec[k] = v
        out.append(rec)
    return clean(out)


def write(name: str, payload):
    path = OUT / f"{name}.json"
    with open(path, "w") as f:
        json.dump(clean(payload), f, separators=(",", ":"))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size/1024:,.0f} KB)")


# --------------------------------------------------------------------------
# Load shared tables
# --------------------------------------------------------------------------
print("Loading tables ...")
calendar = rd(DATA / "2_machine_decision/calendar_day.csv")
calendar["gaming_day_start_utc"] = pd.to_datetime(calendar["gaming_day_start_utc"])
calendar["gaming_day_end_utc"] = pd.to_datetime(calendar["gaming_day_end_utc"])

pdv = rd(DATA / "1_prepared_views/prepared_daily_view.csv")
pdv = pdv[(pdv["gaming_date"] >= START) & (pdv["gaming_date"] <= END)].copy()
pdv["active"] = pdv["active"].astype(str).str.lower().isin(["true", "1", "yes"])
pdv = pdv.merge(calendar[["gaming_date", "scheduled_seconds"]], on="gaming_date", how="left")

machines_reg = rd(DATA / "2_machine_decision/machines.csv")
game_math = rd(DATA / "2_machine_decision/game_math.csv")
locations = rd(DATA / "2_machine_decision/floor_locations.csv")
property_day = rd(DATA / "1_prepared_views/property_day.csv")
player_period = rd(DATA / "1_prepared_views/player_period.csv")
ops = rd(DATA / "2_machine_decision/operations.csv")
catalog = rd(DATA / "2_machine_decision/action_catalog.csv")
cost_rules = rd(DATA / "2_machine_decision/cost_rules.csv")
events = rd(DATA / "4_context/events.csv.gz")
traffic = rd(DATA / "4_context/zone_traffic_hourly.csv.gz")

zones = (
    pdv.dropna(subset=["zone_id"])[["zone_id", "zone_name"]].drop_duplicates().sort_values("zone_id")
)
ZONE_NAME = dict(zip(zones.zone_id, zones.zone_name))


def to_gaming_date(ts: pd.Series) -> pd.Series:
    """Map UTC timestamps to the 6am-6am local gaming date using calendar_day."""
    ts = pd.to_datetime(ts)
    frame = pd.DataFrame({"ts": ts, "_i": np.arange(len(ts))}).sort_values("ts")
    cal = calendar[["gaming_date", "gaming_day_start_utc", "gaming_day_end_utc"]].sort_values("gaming_day_start_utc")
    m = pd.merge_asof(frame, cal, left_on="ts", right_on="gaming_day_start_utc", direction="backward")
    m.loc[m["ts"] >= m["gaming_day_end_utc"], "gaming_date"] = None  # after the last gaming day
    return m.sort_values("_i")["gaming_date"].values


# ==========================================================================
# META / OVERVIEW
# ==========================================================================
print("\n== Overview ==")
pp = player_period
tracked_wager = pp["tracked_coin_in_usd"].sum()
tracked_payout = pp["tracked_payout_usd"].sum()
tracked_net = tracked_wager - tracked_payout
check("Tracked wagering", tracked_wager, 163_804_869.65, source="player_period.tracked_coin_in_usd")
check("Tracked payouts", tracked_payout, 148_219_409.05, source="player_period.tracked_payout_usd")
check("Tracked casino net", tracked_net, 15_585_460.60, source="player_period coin-in - payout")
# NOTE: tracked_net_usd is from the PLAYER's perspective (payout - coin-in), so casino net = -SUM(tracked_net_usd)
check("-tracked_net_usd equals coin-in - payout", -pp["tracked_net_usd"].sum(), tracked_net, tol=0.05,
      source="player_period.tracked_net_usd (player perspective)")

for c in ["opened_at_utc", "work_started_at_utc", "available_at_utc"]:
    ops[c] = pd.to_datetime(ops[c])
ops["downtime_hours"] = (ops["available_at_utc"] - ops["opened_at_utc"]).dt.total_seconds() / 3600
ops["response_hours"] = (ops["work_started_at_utc"] - ops["opened_at_utc"]).dt.total_seconds() / 3600
ops["repair_hours"] = (ops["available_at_utc"] - ops["work_started_at_utc"]).dt.total_seconds() / 3600
check("Operations tickets (all types)", len(ops), 1226, tol=0, source="operations (row count)")
check("Total downtime hours (all tickets)", ops["downtime_hours"].sum(), 5021.08, source="operations available_at - opened_at")

comp_cost = pp["comp_cost_usd"].sum()
comp_face = pp["comp_face_value_usd"].sum()
check("Comp economic cost", comp_cost, 190_669.30, source="player_period.comp_cost_usd")
check("Comp face value", comp_face, 682_749.50, source="player_period.comp_face_value_usd")

prop = property_day.copy()
prop["month"] = prop["gaming_date"].str[:7]

overview = {
    "kpis": {
        "tracked_casino_net": r2(tracked_net),
        "tracked_wagering": r2(tracked_wager),
        "tracked_payouts": r2(tracked_payout),
        "operations_tickets": int(len(ops)),
        "fault_repairs": int((ops.event_type == "fault_repair").sum()),
        "downtime_hours": r2(ops["downtime_hours"].sum()),
        "comp_cost": r2(comp_cost),
        "comp_face_value": r2(comp_face),
        "property_coin_in": r2(prop["coin_in_usd"].sum()),
        "property_house_win": r2(prop["house_win_usd"].sum()),
        "property_theo": r2(prop["theo_usd"].sum()),
        "property_contribution": r2(prop["contribution_after_supplied_costs_usd"].sum()),
    },
    "daily": records(
        prop[[
            "gaming_date", "local_weekday", "events_active", "active_machines", "coin_in_usd", "payout_usd",
            "house_win_usd", "theo_usd", "comp_cost_usd", "comp_face_value_usd", "faults_opened",
            "total_zone_entries_observed", "counter_coverage_share", "carded_coin_in_share",
            "contribution_after_supplied_costs_usd", "available_machine_hours", "occupied_machine_hours",
        ]].fillna({"events_active": ""})
    ),
}

coverage = {
    "date_start": START,
    "date_end": END,
    "gaming_days": int(calendar[(calendar.gaming_date >= START) & (calendar.gaming_date <= END)].shape[0]),
    "machines_registered": int(machines_reg.shape[0]),
    "machine_days": int(pdv.shape[0]),
    "active_machine_days": int(pdv["active"].sum()),
    "inactive_machine_days": int((~pdv["active"]).sum()),
    "tracked_players": int(pp["player_id"].nunique()),
    "player_months": int(pp.shape[0]),
    "counter_hours": int(traffic.shape[0]),
    "counter_hours_ok": int((traffic.counter_status == "ok").sum()),
    "counter_hours_offline": int((traffic.counter_status == "offline").sum()),
    "counter_hours_partial": int((traffic.counter_status == "partial").sum()),
    "avg_counter_coverage_share": r4(prop["counter_coverage_share"].mean()),
    "carded_coin_in_share": r4(pdv.loc[pdv.active, "carded_coin_in_usd"].sum() / pdv.loc[pdv.active, "coin_in_usd"].sum()),
    "operations_tickets": int(len(ops)),
}

# ==========================================================================
# Q1 MACHINE PERFORMANCE
# ==========================================================================
print("\n== Q1 ==")
num_cols = ["available_hours", "occupied_hours", "theo_usd", "house_win_usd", "luck_residual_usd",
            "repair_cost_usd", "faults_opened", "coin_in_usd", "contribution_after_supplied_costs_usd", "paid_spins"]
for c in num_cols:
    pdv[c] = pd.to_numeric(pdv[c], errors="coerce").fillna(0)

# Reproduce finalize_bottom_10.py exactly (full period) for verification
agg = pdv.groupby("machine_id").agg(
    config_id=("config_id", lambda x: x.mode().iloc[0] if not x.mode().empty else "UNKNOWN"),
    observed_days=("gaming_date", "nunique"),
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    theo=("theo_usd", "sum"),
).reset_index()
agg["occ"] = agg.occupied_hours / agg.available_hours.replace(0, np.nan)
agg["tph"] = agg.theo / agg.available_hours.replace(0, np.nan)
agg["tp"] = agg.groupby("config_id")["tph"].rank(pct=True)
agg["op"] = agg.groupby("config_id")["occ"].rank(pct=True)
agg["score"] = 0.6 * (1 - agg.tp) + 0.4 * (1 - agg.op)
elig = agg[(agg.observed_days >= 90) & (agg.available_hours > 0) & agg.score.notna()].sort_values("score", ascending=False)
top10 = elig.head(10)
expected_top10 = ["M-1014", "M-1008", "M-1045", "M-1040", "M-1230", "M-1048", "M-1265", "M-1221", "M-1227", "M-1082"]
check("Q1 top-10 list matches team analysis", float(list(top10.machine_id) == expected_top10), 1.0, tol=0,
      source="prepared_daily_view; finalize_bottom_10.py method")
exp_occ = {"M-1014": 25.11, "M-1008": 20.59, "M-1045": 23.39, "M-1040": 25.68, "M-1230": 21.01,
           "M-1048": 27.86, "M-1265": 25.36, "M-1221": 25.80, "M-1227": 23.63, "M-1082": 22.50}
exp_tph = {"M-1014": 12.75, "M-1008": 9.61, "M-1045": 12.43, "M-1040": 13.18, "M-1230": 10.73,
           "M-1048": 8.53, "M-1265": 7.43, "M-1221": 13.19, "M-1227": 12.78, "M-1082": 10.41}
for _, r in top10.iterrows():
    check(f"Q1 {r.machine_id} occupancy %", round(r.occ * 100, 2), exp_occ[r.machine_id], tol=0.006)
    check(f"Q1 {r.machine_id} theo/hr", round(r.tph, 2), exp_tph[r.machine_id], tol=0.006)

# Per machine x month aggregates (client recomputes the score for any month range)
pdv["month"] = pdv["gaming_date"].str[:7]
mm = pdv.groupby(["machine_id", "month"]).agg(
    days=("gaming_date", "nunique"),
    active_days=("active", "sum"),
    sched_hours=("scheduled_seconds", lambda s: 0),  # placeholder, replaced below
    available_hours=("available_hours", "sum"),
    occupied_hours=("occupied_hours", "sum"),
    coin_in=("coin_in_usd", "sum"),
    theo=("theo_usd", "sum"),
    house_win=("house_win_usd", "sum"),
    luck=("luck_residual_usd", "sum"),
    repair_cost=("repair_cost_usd", "sum"),
    faults=("faults_opened", "sum"),
    contribution=("contribution_after_supplied_costs_usd", "sum"),
    spins=("paid_spins", "sum"),
).reset_index()
sched = pdv[pdv.active].groupby(["machine_id", "month"])["scheduled_seconds"].sum() / 3600
mm["sched_hours"] = mm.set_index(["machine_id", "month"]).index.map(sched).fillna(0).values
mm["active_days"] = mm["active_days"].astype(int)

# Dominant location / zone / bank per machine-month (machines move)
loc_mm = (
    pdv[pdv.active].groupby(["machine_id", "month", "zone_id", "bank_id", "location_id"]).size()
    .reset_index(name="n").sort_values("n", ascending=False).drop_duplicates(["machine_id", "month"])
)
mm = mm.merge(loc_mm[["machine_id", "month", "zone_id", "bank_id", "location_id"]], on=["machine_id", "month"], how="left")

static = (
    pdv.groupby("machine_id").agg(
        theme=("theme", "first"),
        config_id=("config_id", lambda x: x.mode().iloc[0] if not x.mode().empty else "UNKNOWN"),
        manufacturer=("manufacturer", "first"),
        lease_class=("lease_class", "first"),
        configured_rtp=("configured_rtp", "first"),
        volatility=("volatility_class", "first"),
    ).reset_index()
)
dom = (
    pdv[pdv.active].groupby(["machine_id", "zone_id", "bank_id", "location_id"]).size()
    .reset_index(name="n").sort_values("n", ascending=False).drop_duplicates("machine_id")
)
static = static.merge(dom[["machine_id", "zone_id", "bank_id", "location_id"]], on="machine_id", how="left")
static = static.merge(machines_reg[["machine_id", "install_date", "retire_date"]], on="machine_id", how="left")
static["zone_name"] = static.zone_id.map(ZONE_NAME)
moves = pdv[pdv.active].groupby("machine_id")["location_id"].nunique()
static["locations_used"] = static.machine_id.map(moves).fillna(0).astype(int)

# Manager's naive "bottom 10 by total house win" (GUIDE.md starter query) for contrast
naive = pdv[pdv.active].groupby("machine_id")["house_win_usd"].sum().sort_values().head(10)

# Daily series for machine detail drill-down: weekly sums to keep payload small
pdv["week"] = pd.to_datetime(pdv["gaming_date"]).dt.to_period("W-SUN").dt.start_time.dt.strftime("%Y-%m-%d")
wk = pdv.groupby(["machine_id", "week"]).agg(
    available_hours=("available_hours", "sum"), occupied_hours=("occupied_hours", "sum"),
    theo=("theo_usd", "sum"), house_win=("house_win_usd", "sum"), faults=("faults_opened", "sum"),
).reset_index()
weekly = {}
for mid, g in wk.groupby("machine_id"):
    weekly[mid] = [[w, r2(a), r2(o), r2(t), r2(h), int(f)] for w, a, o, t, h, f in
                   g[["week", "available_hours", "occupied_hours", "theo", "house_win", "faults"]].itertuples(index=False)]

q1 = {
    "machines": records(static),
    "machine_month": records(mm, money4=("theo", "house_win", "luck", "coin_in", "contribution", "repair_cost")),
    "weekly": weekly,
    "weekly_columns": ["week_start", "available_hours", "occupied_hours", "theo", "house_win", "faults"],
    "team_top10": expected_top10,
    "naive_bottom10": [{"machine_id": k, "house_win": r2(v)} for k, v in naive.items()],
    "config": records(game_math),
}

# ==========================================================================
# Q2 FLOOR DEMAND
# ==========================================================================
print("\n== Q2 ==")
act = pdv[pdv.active].copy()
zm = act.groupby(["month", "zone_id"]).agg(
    coin_in=("coin_in_usd", "sum"), theo=("theo_usd", "sum"), spins=("paid_spins", "sum"),
    occupied_hours=("occupied_hours", "sum"), available_hours=("available_hours", "sum"),
    machines=("machine_id", "nunique"), machine_days=("machine_id", "size"), days=("gaming_date", "nunique"),
).reset_index()

traffic["gaming_date"] = to_gaming_date(traffic["hour_start_utc"])
traffic = traffic[traffic.gaming_date.notna()]
traffic["month"] = traffic["gaming_date"].str[:7]
tr_ok = traffic[traffic.counter_status != "offline"]
tm = tr_ok.groupby(["month", "zone_id"]).agg(entries=("entries_count", "sum"), coverage_minutes=("coverage_minutes", "sum")).reset_index()
tm["coverage_hours"] = tm.coverage_minutes / 60
zm = zm.merge(tm[["month", "zone_id", "entries", "coverage_hours"]], on=["month", "zone_id"], how="left")
zm["zone_name"] = zm.zone_id.map(ZONE_NAME)

# Cross-check daily coin-in per zone vs team's analysis/q2_floor_demand/outputs/zone_demand_change.csv
team_zdc = pd.read_csv(ROOT / "analysis/q2_floor_demand/outputs/zone_demand_change.csv").set_index("zone_id")
for _, r in zm[zm.month.isin(["2025-01", "2025-06"])].iterrows():
    check(f"Q2 {r.zone_id} {r.month} daily coin-in", r.coin_in / r.days, team_zdc.loc[r.zone_id, r.month], tol=0.01,
          source="analysis/q2_floor_demand/outputs/zone_demand_change.csv")

bm = act.groupby(["month", "bank_id", "zone_id"]).agg(
    coin_in=("coin_in_usd", "sum"), occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"), machines=("machine_id", "nunique"), days=("gaming_date", "nunique"),
).reset_index()

thm = act.groupby(["month", "theme"]).agg(
    coin_in=("coin_in_usd", "sum"), occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"), machines=("machine_id", "nunique"), days=("gaming_date", "nunique"),
).reset_index()
thz = act.groupby(["month", "theme", "zone_id"]).agg(
    coin_in=("coin_in_usd", "sum"), occupied_hours=("occupied_hours", "sum"),
    available_hours=("available_hours", "sum"),
).reset_index()

zd = act.groupby(["gaming_date", "zone_id"]).agg(
    coin_in=("coin_in_usd", "sum"), occupied_hours=("occupied_hours", "sum"), available_hours=("available_hours", "sum"),
).reset_index()
td = tr_ok.groupby(["gaming_date", "zone_id"]).agg(entries=("entries_count", "sum"), coverage_minutes=("coverage_minutes", "sum")).reset_index()
zd = zd.merge(td, on=["gaming_date", "zone_id"], how="left")
zone_daily = {}
corr = {}
for zid, g in zd.groupby("zone_id"):
    zone_daily[zid] = [[d, r2(c), r2(o), r2(a), None if pd.isna(e) else int(e), None if pd.isna(cm) else int(cm)]
                       for d, c, o, a, e, cm in g[["gaming_date", "coin_in", "occupied_hours", "available_hours", "entries", "coverage_minutes"]].itertuples(index=False)]
    gg = g.dropna(subset=["entries"])
    gg = gg[gg.coverage_minutes > 0]
    eph = gg.entries / (gg.coverage_minutes / 60)
    corr[zid] = r4(np.corrcoef(eph, gg.coin_in)[0, 1])

# hourly profile by zone using machine_hour? Use team's output (computed from machine_hour) — documented.
hourly = pd.read_csv(ROOT / "analysis/q2_floor_demand/outputs/q2_hourly_demand_by_zone.csv")
wkwe = act.groupby(["is_weekend", "zone_id"]).agg(coin_in=("coin_in_usd", "sum"), occupied_hours=("occupied_hours", "sum"),
                                                  available_hours=("available_hours", "sum"), days=("gaming_date", "nunique")).reset_index()

city = rd(DATA / "4_context/real_sources/city_visitation_monthly.csv.gz")
city_cols = [c for c in ["month", "visitor_volume", "visitor_yoy_ratio", "hotel_occupancy_ratio", "convention_attendance"] if c in city.columns]
city = city[city_cols] if "month" in city.columns else pd.DataFrame()

q2 = {
    "zones": records(zones),
    "zone_month": records(zm),
    "bank_month": records(bm),
    "theme_month": records(thm),
    "theme_zone_month": records(thz),
    "zone_daily": zone_daily,
    "zone_daily_columns": ["gaming_date", "coin_in", "occupied_hours", "available_hours", "entries", "coverage_minutes"],
    "traffic_demand_corr": corr,
    "hourly_by_zone": records(hourly[["local_hour", "zone_id", "total_coin_in", "occupied_hours", "available_hours", "coin_in_per_available_hour", "occupancy_rate"]]),
    "weekday_weekend": records(wkwe.assign(is_weekend=wkwe.is_weekend.astype(str).str.lower())),
    "events": records(events[["event_id", "name", "event_type", "start_date", "end_date", "announced_date", "local_scope"]]),
    "city_monthly": records(city[city.month.isin(MONTHS)]) if not city.empty else [],
}

# ==========================================================================
# Q3 MAINTENANCE
# ==========================================================================
print("\n== Q3 ==")
rep = pdv[pdv.meter_status == "reported"].groupby("machine_id").agg(theo=("theo_usd", "sum"), avail=("available_hours", "sum"))
theo_rate = (rep.theo / rep.avail).rename("theo_per_hour")
ops["theo_per_hour"] = ops.machine_id.map(theo_rate)
ops["is_fault"] = ops.event_type == "fault_repair"
ops["est_exposure"] = np.where(ops.is_fault, ops.downtime_hours * ops.theo_per_hour, np.nan)
ops["gaming_date"] = to_gaming_date(ops["opened_at_utc"])
ops["opened_at_local"] = pd.to_datetime(ops["opened_at_local"])
ops["local_hour"] = ops["opened_at_local"].dt.hour
ops["weekday"] = pd.to_datetime(ops["gaming_date"]).dt.day_name().str[:3]
loc_zone = locations.set_index("location_id")["zone_id"].to_dict()
loc_bank = locations.set_index("location_id")["bank_id"].to_dict()
ops["zone_id"] = ops.location_id.map(loc_zone)
ops["bank_id"] = ops.location_id.map(loc_bank)
ops["manufacturer"] = ops.machine_id.map(machines_reg.set_index("machine_id").manufacturer)
ops["direct_cost"] = ops.direct_cost_cents / 100

f = ops[ops.is_fault]
check("Average downtime per ticket (all)", ops.downtime_hours.mean(), 4.10, tol=0.005)
check("Average response time (all)", ops.response_hours.mean(), 1.12, tol=0.005)
mexp = f.groupby("machine_id").est_exposure.sum().sort_values(ascending=False)
check("Q3 M-1002 exposure", mexp["M-1002"], 1557.63, tol=0.01)
check("Q3 M-1112 exposure", mexp["M-1112"], 1391.24, tol=0.01)
check("Q3 M-1176 exposure", mexp["M-1176"], 1271.80, tol=0.01)
check("Q3 M-1065 downtime (all tickets)", ops.groupby("machine_id").downtime_hours.sum()["M-1065"], 81.11, tol=0.005)
print("   M-1065 fault-only downtime:", round(f.groupby("machine_id").downtime_hours.sum().get("M-1065", 0), 2))

ops_out = ops[[
    "operation_id", "machine_id", "manufacturer", "zone_id", "bank_id", "location_id", "event_type", "gaming_date",
    "opened_at_local", "local_hour", "weekday", "downtime_hours", "response_hours", "repair_hours", "direct_cost",
    "theo_per_hour", "est_exposure",
]].copy()
ops_out["opened_at_local"] = ops_out.opened_at_local.dt.strftime("%Y-%m-%d %H:%M")
q3 = {
    "tickets": records(ops_out.sort_values("opened_at_local"), money4=("theo_per_hour",)),
    "summary": {
        "tickets": int(len(ops)),
        "fault_repairs": int(len(f)),
        "by_type": ops.event_type.value_counts().to_dict(),
        "downtime_hours_all": r2(ops.downtime_hours.sum()),
        "downtime_hours_fault": r2(f.downtime_hours.sum()),
        "avg_downtime_all": r4(ops.downtime_hours.mean()),
        "avg_response_all": r4(ops.response_hours.mean()),
        "avg_downtime_fault": r4(f.downtime_hours.mean()),
        "avg_response_fault": r4(f.response_hours.mean()),
        "avg_repair_fault": r4(f.repair_hours.mean()),
        "direct_cost_fault": r2(f.direct_cost.sum()),
        "est_exposure_fault": r2(f.est_exposure.sum()),
        "property_theo": r2(prop.theo_usd.sum()),
    },
}

# ==========================================================================
# Q4 PLAYER FINANCIAL INTELLIGENCE
# ==========================================================================
print("\n== Q4 ==")


def gini(values):
    v = np.sort(np.asarray(values, dtype=float))
    n = len(v)
    if n == 0 or v.sum() == 0:
        return float("nan")
    idx = np.arange(1, n + 1)
    return 2 * np.sum(idx * v) / (n * v.sum()) - (n + 1) / n


def lorenz(values, points=50):
    v = np.sort(np.asarray(values, dtype=float))[::-1]  # descending: share held by top x%
    cum = np.cumsum(v) / v.sum()
    n = len(v)
    out = [[0.0, 0.0]]
    for p in np.linspace(0.01, 1, points):
        k = max(1, int(math.ceil(n * p)))
        out.append([round(p * 100, 2), round(cum[k - 1] * 100, 3)])
    return out


def top_share(values_desc, pct):
    n = len(values_desc)
    k = max(1, int(math.ceil(n * pct / 100)))
    return values_desc[:k].sum() / values_desc.sum() * 100


NET_BINS = [-1e12, -10000, -5000, -2500, -1000, -500, -250, -100, -50, -10, -0.005, 0.005, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 1e12]
NET_LABELS = ["≤ -10k", "-10k–-5k", "-5k–-2.5k", "-2.5k–-1k", "-1k–-500", "-500–-250", "-250–-100", "-100–-50", "-50–-10", "-10–0",
              "0 (even)", "0–10", "10–50", "50–100", "100–250", "250–500", "500–1k", "1k–2.5k", "2.5k–5k", "5k–10k", "≥ 10k"]


def player_range(m0: int, m1: int):
    sel = pp[pp.period_month.isin(MONTHS[m0:m1 + 1])]
    pl = sel.groupby("player_id").agg(
        wager=("tracked_coin_in_usd", "sum"), payout=("tracked_payout_usd", "sum"), theo=("theo_usd", "sum"),
        hours=("carded_play_hours", "sum"), comp_cost=("comp_cost_usd", "sum"), sessions=("sessions", "sum"),
    )
    pl["casino_net"] = pl.wager - pl.payout
    pl["player_net"] = -pl.casino_net
    losers = pl[pl.casino_net > 0.0049]
    winners = pl[pl.casino_net < -0.0049]
    even = len(pl) - len(losers) - len(winners)
    loss_desc = np.sort(losers.casino_net.values)[::-1]
    wager_desc = np.sort(pl.wager.values)[::-1]
    hist = pd.cut(pl.player_net, NET_BINS, labels=NET_LABELS, right=False).value_counts().reindex(NET_LABELS).fillna(0)
    return pl, {
        "players": int(len(pl)),
        "wager": r2(pl.wager.sum()), "payout": r2(pl.payout.sum()), "casino_net": r2(pl.casino_net.sum()),
        "theo": r2(pl.theo.sum()), "luck": r2(pl.casino_net.sum() - pl.theo.sum()),
        "losers": int(len(losers)), "winners": int(len(winners)), "even": int(even),
        "gross_losses": r2(losers.casino_net.sum()), "winnings_paid": r2(-winners.casino_net.sum()),
        "loss_share": {str(p): r4(top_share(loss_desc, p)) for p in [1, 5, 10, 20]},
        "wager_share": {str(p): r4(top_share(wager_desc, p)) for p in [1, 5, 10, 20]},
        "gini_wager": r4(gini(pl.wager.values)),
        "gini_losses": r4(gini(loss_desc)),
        "lorenz_wager": lorenz(pl.wager.values),
        "lorenz_losses": lorenz(loss_desc),
        "net_histogram": [{"bin": k, "players": int(v)} for k, v in hist.items()],
        "median_wager": r2(pl.wager.median()),
        "mean_wager": r2(pl.wager.mean()),
    }


ranges = {}
full_players = None
for a in range(6):
    for b in range(a, 6):
        pl, summ = player_range(a, b)
        ranges[f"{a}-{b}"] = summ
        if a == 0 and b == 5:
            full_players = pl
full = ranges["0-5"]
check("Q4 tracked players", full["players"], 113890, tol=0)
check("Q4 losers", full["losers"], 80992, tol=0)
check("Q4 winners", full["winners"], 15504, tol=0)
check("Q4 break-even", full["even"], 17394, tol=0)
check("Q4 gross losses", full["gross_losses"], 20_939_424.55, tol=0.01)
check("Q4 winnings paid", full["winnings_paid"], 5_353_963.95, tol=0.01)
for p, e in {"1": 15.73, "5": 40.73, "10": 52.84, "20": 66.52}.items():
    check(f"Q4 top {p}% loss share", full["loss_share"][p], e, tol=0.006)
check("Q4 top 1% wager share", full["wager_share"]["1"], 22.86, tol=0.006)
check("Q4 top 5% wager share", full["wager_share"]["5"], 55.34, tol=0.006)
check("Q4 wagering Gini", full["gini_wager"], 0.7536, tol=0.00006)

# Segments: player-level within selected range needs distinct players; precompute per range per dimension
seg_dims = {"home_region": "home_region", "age_band": "age_band", "tier_end": "tier_end"}
last_attr = pp.sort_values("period_month").groupby("player_id").agg(
    home_region=("home_region", "last"), age_band=("age_band", "last"), tier_end=("tier_end", "last"))
segments = {}
for a in range(6):
    for b in range(a, 6):
        sel = pp[pp.period_month.isin(MONTHS[a:b + 1])]
        pl = sel.groupby("player_id").agg(
            wager=("tracked_coin_in_usd", "sum"), payout=("tracked_payout_usd", "sum"), theo=("theo_usd", "sum"),
            hours=("carded_play_hours", "sum"), comp_cost=("comp_cost_usd", "sum"), tier_end=("tier_end", "last"),
            home_region=("home_region", "last"), age_band=("age_band", "last"),
        )
        pl["net"] = pl.wager - pl.payout
        out = {}
        for dim in seg_dims:
            g = pl.groupby(dim).agg(
                players=("wager", "size"), wager=("wager", "sum"), payout=("payout", "sum"), net=("net", "sum"),
                theo=("theo", "sum"), hours=("hours", "sum"), comp_cost=("comp_cost", "sum"),
                losers=("net", lambda s: int((s > 0.0049).sum())), winners=("net", lambda s: int((s < -0.0049).sum())),
            ).reset_index().rename(columns={dim: "segment"})
            out[dim] = records(g)
        segments[f"{a}-{b}"] = out

# Wagering-percentile groups (full period) — anonymised, aggregated
fp = full_players.sort_values("wager", ascending=False).reset_index()
n = len(fp)
bands = [(0, 1), (1, 5), (5, 10), (10, 20), (20, 50), (50, 100)]
pct_groups = []
for lo, hi in bands:
    g = fp.iloc[int(math.ceil(n * lo / 100)):int(math.ceil(n * hi / 100))]
    pct_groups.append({
        "group": f"Top {lo}–{hi}%" if lo else f"Top {hi}%", "players": int(len(g)),
        "wager": r2(g.wager.sum()), "payout": r2(g.payout.sum()), "casino_net": r2(g.casino_net.sum()),
        "theo": r2(g.theo.sum()), "hours": r2(g.hours.sum()), "comp_cost": r2(g.comp_cost.sum()),
        "losers": int((g.casino_net > 0.0049).sum()), "winners": int((g.casino_net < -0.0049).sum()),
        "median_net": r2(g.casino_net.median()),
    })
# Top 100 wagering players with anonymised rank aliases (no raw IDs exported)
top = fp.head(100).join(last_attr, on="player_id")
top_players = [{
    "alias": f"Player-{i+1:03d}", "tier_end": r.tier_end, "home_region": r.home_region, "age_band": r.age_band,
    "wager": r2(r.wager), "payout": r2(r.payout), "casino_net": r2(r.casino_net), "theo": r2(r.theo),
    "luck": r2(r.casino_net - r.theo), "hours": r2(r.hours), "sessions": int(r.sessions),
} for i, r in enumerate(top.itertuples())]

monthly_pp = pp.groupby("period_month").agg(
    players=("player_id", "nunique"), wager=("tracked_coin_in_usd", "sum"), payout=("tracked_payout_usd", "sum"),
    theo=("theo_usd", "sum"), hours=("carded_play_hours", "sum"),
).reset_index()
monthly_pp["casino_net"] = monthly_pp.wager - monthly_pp.payout
q4 = {"ranges": ranges, "segments": segments, "percentile_groups": pct_groups, "top_players": top_players,
      "monthly": records(monthly_pp), "months": MONTHS}

# ==========================================================================
# Q5 LOYALTY
# ==========================================================================
print("\n== Q5 ==")
ledger = rd(DATA / "3_guests/loyalty_ledger.csv",
                     usecols=["event_at_utc", "event_type", "benefit_id", "points_delta", "tier_before", "tier_after",
                              "face_value_cents", "economic_cost_cents", "player_id"])
ledger["gaming_date"] = to_gaming_date(ledger["event_at_utc"])
ledger["utc_month"] = ledger.event_at_utc.str[:7]
ledger["month"] = ledger["gaming_date"].str[:7]
unmapped = ledger.gaming_date.isna().sum()
print("   ledger rows after last gaming day (partial July):", unmapped)

check("Ledger economic cost", ledger.economic_cost_cents.sum() / 100, 190_669.30)
check("Ledger face value", ledger.face_value_cents.sum() / 100, 682_749.50)
check("Ledger redemptions", (ledger.event_type == "redeem").sum(), 59361, tol=0)
check("Ledger award events", (ledger.event_type == "award").sum(), 723412, tol=0)
check("player_period comps redeemed", pp.comps_redeemed.sum(), 59361, tol=0)
check("Average comp cost per unique player", comp_cost / pp.player_id.nunique(), 1.67, tol=0.005)
trans = ledger[ledger.tier_before.notna() & ledger.tier_after.notna() & (ledger.tier_before != ledger.tier_after)]
check("Tier transitions", len(trans), 6630, tol=0)

mp = pp.groupby("period_month").agg(
    comp_cost=("comp_cost_usd", "sum"), face=("comp_face_value_usd", "sum"), redemptions=("comps_redeemed", "sum"),
    players=("player_id", "nunique"), tracked_theo=("theo_usd", "sum"), points_earned=("points_earned", "sum"),
    points_redeemed=("points_redeemed", "sum"),
    redeeming_players=("comps_redeemed", lambda s: int((s > 0).sum())),
).reset_index().rename(columns={"period_month": "month"})
pm = prop.groupby("month").agg(prop_comp_cost=("comp_cost_usd", "sum"), prop_face=("comp_face_value_usd", "sum"),
                               prop_theo=("theo_usd", "sum"), days=("gaming_date", "nunique")).reset_index()
mp = mp.merge(pm, on="month")
mp["cost_pct_tracked_theo"] = mp.comp_cost / mp.tracked_theo * 100
mp["cost_pct_property_theo"] = mp.comp_cost / mp.prop_theo * 100
exp_month = {"2025-01": (28750.30, 1.11), "2025-02": (29854.30, 1.20), "2025-03": (33255.50, 1.22),
             "2025-04": (31390.30, 1.24), "2025-05": (34446.10, 1.30), "2025-06": (32972.80, 1.32)}
for _, r in mp.iterrows():
    check(f"Q5 {r.month} comp cost", r.comp_cost, exp_month[r.month][0], tol=0.01)
    check(f"Q5 {r.month} cost / tracked theo %", round(r.cost_pct_tracked_theo, 2), exp_month[r.month][1], tol=0.006)

lm = ledger.groupby(["utc_month", "event_type"]).agg(
    events=("points_delta", "size"), points=("points_delta", "sum"),
    cost=("economic_cost_cents", "sum"), face=("face_value_cents", "sum"),
).reset_index()
lm["cost"] /= 100
lm["face"] /= 100

lg = ledger[ledger.gaming_date.notna()]
red = lg[lg.event_type == "redeem"]
daily_red = red.groupby("gaming_date").agg(redemptions=("points_delta", "size"), points=("points_delta", "sum"),
                                           face=("face_value_cents", "sum"), cost=("economic_cost_cents", "sum")).reset_index()
daily_red["points_per_face_dollar"] = -daily_red.points / (daily_red.face / 100)
daily_aw = lg[lg.event_type == "award"].groupby("gaming_date").agg(awards=("points_delta", "size"), award_points=("points_delta", "sum")).reset_index()
daily_l = daily_red.merge(daily_aw, on="gaming_date", how="outer").sort_values("gaming_date")
daily_l["face"] /= 100
daily_l["cost"] /= 100

ppd_tier = red.assign(m=red.gaming_date.str[:7]).groupby(["tier_before", "m"]).agg(p=("points_delta", "sum"), f=("face_value_cents", "sum")).reset_index()
ppd_tier["points_per_face_dollar"] = -ppd_tier.p / (ppd_tier.f / 100)
ppd_benefit = red.assign(m=red.gaming_date.str[:7]).groupby(["benefit_id", "m"]).agg(
    n=("points_delta", "size"), avg_points=("points_delta", "mean"), face=("face_value_cents", "mean"), cost=("economic_cost_cents", "mean")).reset_index()
ppd_benefit["avg_points"] = -ppd_benefit.avg_points
ppd_benefit["face"] /= 100
ppd_benefit["cost"] /= 100

trans = trans.assign(path=trans.tier_before + " → " + trans.tier_after, m=trans.gaming_date.fillna("2025-07").str[:7])
trans_m = trans.groupby(["m", "path"]).size().reset_index(name="n")
tier_cost = pp.groupby("tier_end").agg(players=("player_id", "nunique"), comp_cost=("comp_cost_usd", "sum"),
                                       face=("comp_face_value_usd", "sum"), theo=("theo_usd", "sum"),
                                       redemptions=("comps_redeemed", "sum")).reset_index()

recon = [
    {"source": "player_period (player × month)", "table": "1_prepared_views/player_period", "fields": "comp_cost_usd, comp_face_value_usd",
     "economic_cost": r2(pp.comp_cost_usd.sum()), "face_value": r2(pp.comp_face_value_usd.sum()), "redemptions": int(pp.comps_redeemed.sum())},
    {"source": "property_day (day)", "table": "1_prepared_views/property_day", "fields": "comp_cost_usd, comp_face_value_usd",
     "economic_cost": r2(prop.comp_cost_usd.sum()), "face_value": r2(prop.comp_face_value_usd.sum()), "redemptions": None},
    {"source": "loyalty_ledger (event)", "table": "3_guests/loyalty_ledger", "fields": "economic_cost_cents ÷ 100, face_value_cents ÷ 100",
     "economic_cost": r2(ledger.economic_cost_cents.sum() / 100), "face_value": r2(ledger.face_value_cents.sum() / 100),
     "redemptions": int((ledger.event_type == "redeem").sum())},
]
check("Recon property_day cost", recon[1]["economic_cost"], 190_669.30)

pre = ppd_tier[ppd_tier.m.isin(MONTHS[:4])]
post = ppd_tier[ppd_tier.m.isin(MONTHS[4:])]
q5 = {
    "monthly": records(mp),
    "ledger_utc_month": records(lm),
    "ledger_daily": records(daily_l),
    "points_per_dollar_by_tier": records(ppd_tier.rename(columns={"m": "month"})[["tier_before", "month", "points_per_face_dollar"]]),
    "benefits": records(ppd_benefit.rename(columns={"m": "month"})),
    "tier_transitions": records(trans_m.rename(columns={"m": "month"})),
    "tier_paths": trans.path.value_counts().to_dict(),
    "tier_cost": records(tier_cost),
    "reconciliation": recon,
    "summary": {
        "economic_cost": r2(comp_cost), "face_value": r2(comp_face), "redemptions": int(pp.comps_redeemed.sum()),
        "unique_players": int(pp.player_id.nunique()), "avg_cost_per_player": r4(comp_cost / pp.player_id.nunique()),
        "award_events": int((ledger.event_type == "award").sum()), "tier_transitions": int(len(trans)),
        "ledger_rows_after_june": int(unmapped),
        "cost_to_face": r4(comp_cost / comp_face),
    },
}

# ==========================================================================
# FORECAST (time-series, time-based holdout)
# ==========================================================================
print("\n== Forecast ==")
fc = prop[["gaming_date", "local_weekday", "coin_in_usd"]].copy()
fc["date"] = pd.to_datetime(fc.gaming_date)
fc["dow"] = fc.date.dt.day_of_week
cal_h = calendar.set_index("gaming_date")["federal_holiday"]
fc["holiday"] = fc.gaming_date.map(cal_h).notna().astype(int)
FREEZE = pd.Timestamp("2025-04-30")
train = fc[fc.date <= FREEZE].copy()
test = fc[fc.date > FREEZE].copy()

# Event flags: only events announced on or before the freeze date may be used (no look-ahead).
ev = events.copy()
ev["start_date"] = pd.to_datetime(ev.start_date)
ev["end_date"] = pd.to_datetime(ev.end_date)
ev["announced_date"] = pd.to_datetime(ev.announced_date)
known = ev[ev.announced_date <= FREEZE]
excluded_events = ev[ev.announced_date > FREEZE][["event_id", "name", "announced_date"]]


def event_flag(dates: pd.Series) -> np.ndarray:
    flag = np.zeros(len(dates), dtype=int)
    for _, e in known.iterrows():
        flag |= ((dates >= e.start_date) & (dates <= e.end_date)).values.astype(int)
    return flag


fc["event"] = event_flag(fc.date)
train = fc[fc.date <= FREEZE].copy()
test = fc[fc.date > FREEZE].copy()

# Baseline 1: training-period mean
pred_mean = np.full(len(test), train.coin_in_usd.mean())
# Baseline 2: weekday average
wd_mean = train.groupby("dow").coin_in_usd.mean()
pred_wd = test.dow.map(wd_mean).values


# Candidate: OLS regression with weekday dummies + holiday + pre-announced event flag + linear trend,
# fitted on Jan-Apr only. Multi-step forecast uses only calendar features known in advance.
def design(df, t0):
    X = [np.ones(len(df))]
    for d in range(1, 7):
        X.append((df.dow == d).astype(float).values)
    X.append(df.holiday.values.astype(float))
    X.append(df.event.values.astype(float))
    X.append(((df.date - t0).dt.days.values / 30.0))
    return np.column_stack(X)


t0 = train.date.min()
Xtr, Xte = design(train, t0), design(test, t0)
beta, *_ = np.linalg.lstsq(Xtr, train.coin_in_usd.values, rcond=None)
pred_reg = Xte @ beta

# Candidate 2: seasonal-naive-with-AR on weekday residuals (recursive, no holdout actuals)
res_tr = train.coin_in_usd.values - train.dow.map(wd_mean).values
phi = np.dot(res_tr[1:], res_tr[:-1]) / np.dot(res_tr[:-1], res_tr[:-1])
r_last = res_tr[-1]
ar_res = []
for _ in range(len(test)):
    r_last = phi * r_last
    ar_res.append(r_last)
pred_ar = pred_wd + np.array(ar_res)


def mae(p):
    return float(np.mean(np.abs(test.coin_in_usd.values - p)))


def mape(p):
    return float(np.mean(np.abs(test.coin_in_usd.values - p) / test.coin_in_usd.values) * 100)


models = [
    {"id": "mean", "name": "Baseline 1 — training mean", "kind": "baseline", "mae": mae(pred_mean), "mape": mape(pred_mean)},
    {"id": "weekday", "name": "Baseline 2 — weekday average", "kind": "baseline", "mae": mae(pred_wd), "mape": mape(pred_wd)},
    {"id": "ar", "name": "Weekday avg + AR(1) residual", "kind": "candidate", "mae": mae(pred_ar), "mape": mape(pred_ar), "phi": phi},
    {"id": "regression", "name": "Calendar regression (weekday + holiday + known events + trend)", "kind": "candidate",
     "mae": mae(pred_reg), "mape": mape(pred_reg)},
]
# Paired comparison of absolute errors vs the weekday baseline (is the gain larger than noise?)
err_wd = np.abs(test.coin_in_usd.values - pred_wd)
for m_, p_ in zip(models, [pred_mean, pred_wd, pred_ar, pred_reg]):
    d = err_wd - np.abs(test.coin_in_usd.values - p_)
    m_["mae_gain_vs_weekday"] = float(d.mean())
    m_["gain_se"] = float(d.std(ddof=1) / np.sqrt(len(d))) if d.std() > 0 else 0.0
    m_["days_better_than_weekday"] = int((d > 0).sum())
    rng = np.random.default_rng(42)
    # moving-block bootstrap (7-day blocks) of the mean gain
    boots = []
    nb = int(np.ceil(len(d) / 7))
    for _ in range(2000):
        starts = rng.integers(0, len(d) - 7 + 1, nb)
        boots.append(np.concatenate([d[s:s + 7] for s in starts])[:len(d)].mean())
    m_["gain_ci95"] = [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))]
for m_ in models:
    print(f"   {m_['name']}: MAE ${m_['mae']:,.0f}  MAPE {m_['mape']:.2f}%")

# Weekday-level holdout error for the decision
test_out = test.assign(pred_mean=pred_mean, pred_weekday=pred_wd, pred_ar=pred_ar, pred_regression=pred_reg)
train_fit = train.assign(fit_weekday=train.dow.map(wd_mean).values, fit_regression=Xtr @ beta)
wd_actual = test.groupby("local_weekday").coin_in_usd.mean()
forecast = {
    "freeze_date": "2025-04-30",
    "train": [START, "2025-04-30"], "holdout": ["2025-05-01", END],
    "n_train": int(len(train)), "n_test": int(len(test)),
    "models": models,
    "coef": {"intercept": beta[0], **{f"dow_{d}": beta[d] for d in range(1, 7)}, "holiday": beta[7], "event": beta[8], "trend_per_30d": beta[9]},
    "known_events": records(known[["event_id", "name", "start_date", "end_date", "announced_date"]].astype(str)),
    "excluded_events": records(excluded_events.astype(str)),
    "series": records(pd.concat([
        train_fit.assign(split="train")[["gaming_date", "local_weekday", "coin_in_usd", "split", "fit_weekday", "fit_regression"]],
        test_out.assign(split="holdout")[["gaming_date", "local_weekday", "coin_in_usd", "split", "pred_mean", "pred_weekday", "pred_ar", "pred_regression"]],
    ], ignore_index=True)),
    "weekday_profile": [{"weekday": d, "train_avg": r2(train.groupby("local_weekday").coin_in_usd.mean()[d]),
                         "holdout_avg": r2(wd_actual[d])} for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]],
}

# ==========================================================================
# RECOMMENDATIONS — costs from action_catalog using the GUIDE.md budget formula
# ==========================================================================
print("\n== Recommendations ==")
HORIZON = 30


def action_cost(aid: str, qty: int) -> dict:
    a = catalog.set_index("action_type_id").loc[aid]
    days = max(0, HORIZON - int(a.lead_days))
    cost = qty * (a.unit_cost_cents + a.recurring_cost_cents_per_day * days) / 100
    assert qty <= a.quantity_limit, f"{aid} qty {qty} exceeds limit {a.quantity_limit}"
    return {"action_type_id": aid, "name": a["name"], "unit": a.unit, "quantity": qty,
            "unit_cost": a.unit_cost_cents / 100, "recurring_per_day": a.recurring_cost_cents_per_day / 100,
            "lead_days": int(a.lead_days), "operating_days": days, "downtime_minutes": int(a.downtime_minutes),
            "quantity_limit": int(a.quantity_limit), "incompatibility_group": None if pd.isna(a.incompatibility_group) else a.incompatibility_group,
            "notes": a.notes, "total_cost": round(float(cost), 2)}


# Evidence numbers used by recommendations
bf = zm[zm.zone_id == "Z-B40"]
others = zm[zm.zone_id != "Z-B40"]
bf_tph = bf.theo.sum() / bf.available_hours.sum()
bf_theo_day = bf.theo.sum() / 181
mf = f.groupby("manufacturer").agg(tickets=("operation_id", "size"), downtime=("downtime_hours", "sum"),
                                  exposure=("est_exposure", "sum"), cost=("direct_cost", "sum"), response=("response_hours", "mean"))
mf["machines"] = static.groupby("manufacturer").machine_id.nunique()
mf["tickets_per_machine"] = mf.tickets / mf.machines
ridge = mf.loc["Ridgeline"]

selected = [action_cost("A-WAYFINDING", 1), action_cost("A-PREVENTIVE", 1), action_cost("A-COMP-PILOT", 1)]
spent = sum(a["total_cost"] for a in selected)
alt = [action_cost("A-REPLACE-BUY", 10), action_cost("A-REPLACE-LEASE", 10), action_cost("A-TECH-SHIFT", 1),
       action_cost("A-INSPECT", 10), action_cost("A-COMP-CHANGE", 1), action_cost("A-PROMO", 1)]

# Sensitivity (scenario) estimates — theo-based, clearly labelled as assumptions
wf_days = selected[0]["operating_days"]
pm_days = selected[1]["operating_days"]
ridge_exp_per_day = ridge.exposure / 181
ridge_ids = static[static.manufacturer == "Ridgeline"].machine_id
ridge_n = int(pdv[(pdv.gaming_date == END) & pdv.active & pdv.machine_id.isin(ridge_ids)].shape[0])
rr = pdv[pdv.machine_id.isin(ridge_ids) & pdv.active]
ridge_theo_rate = rr.theo_usd.sum() / rr.available_hours.sum()
ridge_dt_per_day = ridge.downtime / 181
recs = {
    "budget": 100000, "horizon_days": HORIZON, "spent": round(spent, 2), "preserved": round(100000 - spent, 2),
    "selected": selected, "alternatives": alt,
    "catalog": records(catalog.assign(unit_cost=catalog.unit_cost_cents / 100, recurring_per_day=catalog.recurring_cost_cents_per_day / 100)),
    "cost_rules": records(cost_rules),
    "evidence": {
        "back_forty_theo_per_avail_hour": r4(bf_tph),
        "other_theo_per_avail_hour": r4(others.theo.sum() / others.available_hours.sum()),
        "back_forty_occupancy": r4(bf.occupied_hours.sum() / bf.available_hours.sum()),
        "other_occupancy": r4(others.occupied_hours.sum() / others.available_hours.sum()),
        "back_forty_theo_per_day": r2(bf_theo_day),
        "back_forty_machines": int(static[static.zone_id == "Z-B40"].shape[0]),
        "wayfinding_scenarios": [{"lift_pct": p, "theo_gain": r2(bf_theo_day * p / 100 * wf_days)} for p in [1, 2, 5, 10]],
        "manufacturer": records(mf.reset_index()),
        "ridgeline_exposure_per_day": r2(ridge_exp_per_day),
        "ridgeline_downtime_per_day": r4(ridge_dt_per_day),
        "ridgeline_repair_cost_per_day": r2(ridge.cost / 181),
        "ridgeline_theo_per_hour": r4(ridge_theo_rate),
        "preventive_planned_downtime_hours": r2(ridge_n * 1.5),
        "preventive_planned_downtime_theo_upper": r2(ridge_n * 1.5 * ridge_theo_rate),
        "preventive_breakeven_reduction_pct": r2(9000 / ((ridge_exp_per_day + ridge.cost / 181) * pm_days) * 100),
        "wayfinding_breakeven_lift_pct": r2(7500 / (bf_theo_day * wf_days) * 100),
        "preventive_scenarios": [{"reduction_pct": p, "downtime_hours_avoided": r2(ridge_dt_per_day * p / 100 * pm_days),
                                  "theo_exposure_avoided": r2(ridge_exp_per_day * p / 100 * pm_days),
                                  "repair_cost_avoided": r2(ridge.cost / 181 * p / 100 * pm_days)} for p in [10, 25, 42, 50]],
        "tech_shift_response_share": r4(f.response_hours.sum() / f.downtime_hours.sum()),
        "tech_shift_max_monthly_exposure": r2(f.est_exposure.sum() / 181 * 30 * f.response_hours.sum() / f.downtime_hours.sum()),
        "fault_exposure_per_30d": r2(f.est_exposure.sum() / 181 * 30),
        "comp_monthly_cost_mayjun": r2(mp[mp.month.isin(MONTHS[4:])].comp_cost.mean()),
        "comp_monthly_cost_janapr": r2(mp[mp.month.isin(MONTHS[:4])].comp_cost.mean()),
        "ppd_pre": records(pre.groupby("tier_before").points_per_face_dollar.mean().reset_index()),
        "ppd_post": records(post.groupby("tier_before").points_per_face_dollar.mean().reset_index()),
    },
}

meta = {
    "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "data_release": json.load(open(DATA / "manifest.json")).get("version", "unknown") if (DATA / "manifest.json").exists() else "unknown",
    "coverage": coverage,
    "checks": checks,
    "checks_passed": sum(c["ok"] for c in checks),
    "checks_total": len(checks),
}

write("meta", meta)
write("overview", overview)
write("q1", q1)
write("q2", q2)
write("q3", q3)
write("q4", q4)
write("q5", q5)
write("forecast", forecast)
write("recommendations", recs)

failed = [c for c in checks if not c["ok"]]
print(f"\nVerification: {len(checks) - len(failed)}/{len(checks)} checks passed")
if failed:
    for c in failed:
        print("  FAILED:", c["name"], c["computed"], "vs", c["expected"])
    raise SystemExit(1)
