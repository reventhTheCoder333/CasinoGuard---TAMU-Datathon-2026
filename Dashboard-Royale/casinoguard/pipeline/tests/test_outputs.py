"""Integration tests on the generated dashboard data (run build_data.py first).

Each test recomputes a published result independently from lower-level outputs or the
raw tables, so a regression in the pipeline or a hand-edited JSON file is caught.
"""
import json
import math
import sys
from pathlib import Path

import pandas as pd
import pytest

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import analytics as an  # noqa: E402

ROOT = HERE.parents[3]
OUT = ROOT / "casinoguard" / "public" / "data"
DATA = ROOT / "data"


def load(name):
    return json.loads((OUT / f"{name}.json").read_text())


def read_csv(rel):
    p = DATA / rel
    return pd.read_csv(p if p.exists() else p.with_name(p.name + ".gz"))


@pytest.fixture(scope="module")
def q1():
    return load("q1")


@pytest.fixture(scope="module")
def recs():
    return load("recommendations")


def test_all_pipeline_checks_pass():
    meta = load("meta")
    assert meta["checks_passed"] == meta["checks_total"] > 80


def test_payout_z_recomputed_from_machine_month_and_game_math(q1):
    gm = read_csv("2_machine_decision/game_math.csv").set_index("config_id")
    d = q1["diagnostics"]
    top = min(d["machines"], key=lambda m: m["z"])
    rows = [r for r in q1["machine_month"] if r["machine_id"] == top["machine_id"]]
    ci, th, hw, sp = (sum(r[k] for r in rows) for k in ("coin_in", "theo", "house_win", "spins"))
    g = gm.loc[top["config_id"]]
    factor = an.bet_mix_factor([float(x) for x in str(g.bet_options_cents).split("|")])
    _, _, z = an.hold_z(ci, th, hw, sp, float(g.payout_multiplier_variance), factor)
    assert z == pytest.approx(top["z"], rel=1e-3)
    assert top["payout_verdict"] == "payout anomaly lead" and z <= -d["z_flag"]
    below = sum(1 for r in rows if r["spins"] > 0 and r["house_win"] < r["theo"])
    assert below == top["months_below"]


def test_flag_threshold_is_bonferroni_over_all_tested(q1):
    d = q1["diagnostics"]
    assert d["tests"] == len(d["machines"])
    assert d["z_flag"] == pytest.approx(an.z_threshold(d["alpha"], d["tests"]))
    flagged = [m for m in d["machines"] if m["payout_verdict"] == "payout anomaly lead"]
    assert all(m["z"] <= -d["z_flag"] for m in flagged)


def test_candidate_verdicts_follow_zone_percentile(q1):
    d = q1["diagnostics"]
    assert len(d["candidates"]) == 10
    for c in d["candidates"]:
        machine_specific = c["zone_pct"] <= d["location_pct"]
        assert c["verdict"].startswith("machine-specific") == machine_specific
    assert d["candidates_location"] == sum(c["verdict"].startswith("location") for c in d["candidates"])


def test_closure_windows_come_from_floor_walkways():
    q2 = load("q2")
    ww = read_csv("2_machine_decision/floor_walkways.csv").dropna(subset=["closed_from_utc"])
    assert [c["walkway_id"] for c in q2["closures"]] == list(ww.walkway_id)
    c = q2["closures"][0]
    assert c["windows"]["whole_weeks"]
    assert c["weekday_counts"]["before"] == c["weekday_counts"]["during"] == c["weekday_counts"]["after"]


def test_closure_change_recomputed_from_zone_daily():
    q2 = load("q2")
    c = q2["closures"][0]
    zid = c["zone_b"]
    daily = pd.DataFrame(q2["zone_daily"][zid], columns=q2["zone_daily_columns"])

    def per_day(win):
        w = daily[(daily.gaming_date >= win[0]) & (daily.gaming_date <= win[1])]
        return w.coin_in.sum() / w.gaming_date.nunique()

    b, du = per_day(c["windows"]["before"]), per_day(c["windows"]["during"])
    assert (du / b - 1) * 100 == pytest.approx(c["zones"][zid]["chg_during_pct"], abs=0.01)


def test_budget_rules(recs):
    sel = recs["selected"]
    assert len({a["action_type_id"] for a in sel}) <= 3
    assert recs["spent"] == pytest.approx(sum(a["total_cost"] for a in sel))
    assert recs["spent"] + recs["preserved"] == recs["budget"] == 100000
    groups = [a["incompatibility_group"] for a in sel if a["incompatibility_group"]]
    assert len(groups) == len(set(groups))
    cat = read_csv("2_machine_decision/action_catalog.csv").set_index("action_type_id")
    for a in sel:
        c = cat.loc[a["action_type_id"]]
        days = max(0, 30 - int(c.lead_days))
        assert a["total_cost"] == pytest.approx(a["quantity"] * (c.unit_cost_cents + c.recurring_cost_cents_per_day * days) / 100)
        assert a["quantity"] <= c.quantity_limit


def test_inspection_targets_are_lowest_z_on_floor(q1, recs):
    d = q1["diagnostics"]
    on_floor = sorted((m for m in d["machines"] if m["on_floor_jun30"]), key=lambda m: m["z"])
    targets = [t["machine_id"] for t in recs["plan"]["A-INSPECT"]["targets"]]
    assert targets == [m["machine_id"] for m in on_floor[:len(targets)]]


def test_scenarios_are_consistent(recs):
    for aid, p in recs["plan"].items():
        s = p["scenarios"]
        assert s["low"]["benefit"] == 0
        assert s["low"]["benefit"] <= s["base"]["benefit"] <= s["high"]["benefit"]
        cost = p.get("cost_with_downtime", next(a["total_cost"] for a in recs["selected"] if a["action_type_id"] == aid))
        for v in s.values():
            assert v["net"] == pytest.approx(v["benefit"] - cost, abs=0.02)
        if p["full_benefit"] > 0:
            assert p["break_even_pct"] == pytest.approx(cost / p["full_benefit"] * 100, rel=1e-6)


def test_forecast_decisions_use_frozen_model_only():
    fc = load("forecast")
    dec = fc["decisions"]
    assert len(dec["july"]) == 30 and dec["july"][0]["gaming_date"] == "2025-07-01"
    lead = int(read_csv("2_machine_decision/action_catalog.csv").set_index("action_type_id").loc["A-INSPECT"].lead_days)
    july = pd.DataFrame(dec["july"]).iloc[lead:]
    expected = list(july.nsmallest(len(dec["quiet_days"]["A-INSPECT"]), "pred_regression").gaming_date)
    assert dec["quiet_days"]["A-INSPECT"] == expected
    assert fc["freeze_date"] == "2025-04-30"
    assert all(e["announced_date"] <= fc["freeze_date"] for e in fc["known_events"])


def test_claims_cover_every_question_and_cite_sources():
    claims = load("claims")["claims"]
    assert {c["q"] for c in claims} >= {"Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "ML"}
    for c in claims:
        for k in ("claim", "result", "calculation", "query", "alt", "test", "limit", "tables"):
            assert c[k], f"claim missing {k}: {c['claim']}"
        assert all((DATA / t).with_suffix(".csv.gz").exists() or (DATA / f"{t}.csv").exists()
                   or (DATA / f"{t}.parquet").exists() for t in c["tables"]), c["tables"]


def test_claim_numbers_match_payloads(q1):
    claims = load("claims")["claims"]
    top = min(q1["diagnostics"]["machines"], key=lambda m: m["z"])
    leak = next(c for c in claims if top["machine_id"] in c["claim"])
    assert f"z = {top['z']:.2f}" in leak["result"]
    assert not math.isnan(top["z"])
