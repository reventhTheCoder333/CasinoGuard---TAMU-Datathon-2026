"""Build the assistant's knowledge base from the dashboard's verified data.

Every number comes from casinoguard/public/data/*.json (generated and checked
by casinoguard/pipeline/build_data.py) or from the verified claims listed on
the Methodology page. Nothing is typed in by hand, so the assistant can only
repeat figures the dashboard itself shows.

Run from the repository root after regenerating the dashboard data:
    python Dashboard-Royale/assistant/build_knowledge.py
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "casinoguard" / "public" / "data"
METHODOLOGY = HERE.parent / "casinoguard" / "src" / "pages" / "Methodology.tsx"
OUT = HERE / "knowledge_base.json"

MONTHS = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]
MONTH_NAMES = dict(zip(MONTHS, ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]))


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


def usd(value, decimals=0):
    return f"${value:,.{decimals}f}"


def pct(fraction, decimals=1):
    return f"{fraction * 100:.{decimals}f}%"


def entry(entry_id, topic, title, page, keywords, content, source):
    return {
        "id": entry_id,
        "topic": topic,
        "title": title,
        "page": page,
        "keywords": keywords,
        "content": " ".join(content.split()),
        "source": source,
    }


def methodology_claims():
    """The verified claims table on the Methodology page."""
    text = METHODOLOGY.read_text()
    pattern = re.compile(
        r"\{ claim: '([^']*)', evidence: '([^']*)', result: '([^']*)', "
        r"alt: '([^']*)', limit: '([^']*)', to: '([^']*)'"
    )
    topics = {"/q1": "Q1", "/q2": "Q2", "/q3": "Q3", "/q4": "Q4", "/q5": "Q5",
              "/model": "Forecast", "/q6": "Q6", "/recommendations": "Q6"}
    claims = []

    for index, (claim, evidence, result, alt, limit, to) in enumerate(pattern.findall(text), 1):
        claims.append(entry(
            f"claim-{index}", topics.get(to, "Methodology"), f"Verified claim: {claim}",
            to, ["verified", "claim", "evidence", "methodology"],
            f"Claim: {claim} Evidence used: {evidence}. Result: {result}. "
            f"Alternative explanation considered: {alt}. Limitation: {limit}.",
            "Methodology page — verified claims",
        ))

    if not claims:
        raise SystemExit("No claims parsed from Methodology.tsx; check its format")
    return claims


def build():
    overview, meta = load("overview"), load("meta")
    q1, q2, q3, q4, q5 = load("q1"), load("q2"), load("q3"), load("q4"), load("q5")
    forecast, recs = load("forecast"), load("recommendations")
    k = overview["kpis"]
    ev = recs["evidence"]
    s3 = q3["summary"]
    entries = []

    # Overview -----------------------------------------------------------
    entries.append(entry(
        "overview", "Overview", "Project overview and headline figures", "/",
        ["overview", "summary", "gilded ace", "casino", "headline", "kpi", "data"],
        f"""Dashboard Royale analyses The Gilded Ace, a fictional 300-machine casino, for
        January–June 2025 using synthetic data (data release {meta['data_release']}).
        Tracked casino net {usd(k['tracked_casino_net'], 2)}; tracked wagering
        {usd(k['tracked_wagering'], 2)}; tracked payouts {usd(k['tracked_payouts'], 2)}.
        Property coin-in {usd(k['property_coin_in'], 2)}, house win
        {usd(k['property_house_win'], 2)}, theoretical win {usd(k['property_theo'], 2)}.
        {k['operations_tickets']:,} operations tickets ({k['fault_repairs']:,} fault repairs),
        {k['downtime_hours']:,.2f} downtime hours. Comp cost {usd(k['comp_cost'], 2)}
        (face value {usd(k['comp_face_value'], 2)}). {meta['checks_passed']} of
        {meta['checks_total']} verification checks pass.""",
        "overview.json, meta.json",
    ))

    # Q1 ------------------------------------------------------------------
    zone = {m["machine_id"]: m["zone_name"] for m in q1["machines"]}
    candidates = q1["team_top10"]
    in_bf = sum(zone[m] == "Back Forty" for m in candidates)
    entries.append(entry(
        "q1-answer", "Q1", "Q1: Which machines are underperforming?", "/q1",
        ["q1", "underperforming", "machines", "candidates", "bottom", "back forty", "location", "ranking"],
        f"""Q1 asks which machines underperform. The exposure-adjusted ranking compares each
        machine with same-configuration peers. It produced {len(candidates)} preliminary
        candidates (not replacement orders): {', '.join(candidates)}. {in_bf} of
        {len(candidates)} are in the Back Forty zone. Back Forty earns
        {usd(ev['back_forty_theo_per_avail_hour'], 2)} theoretical win per available machine
        hour versus {usd(ev['other_theo_per_avail_hour'], 2)} elsewhere, at
        {pct(ev['back_forty_occupancy'])} occupancy versus {pct(ev['other_occupancy'])}.
        Conclusion: location, not the machines themselves, is the leading explanation.""",
        "q1.json, recommendations.json evidence",
    ))

    # Q2 ------------------------------------------------------------------
    coin = {m: sum(z["coin_in"] for z in q2["zone_month"] if z["month"] == m) for m in MONTHS}
    monthly = ", ".join(f"{MONTH_NAMES[m]} {usd(coin[m] / 1e6, 2)}M" for m in MONTHS)
    peak = max(coin, key=coin.get)
    low = min(coin, key=coin.get)
    zone_changes = []
    for z in q2["zones"]:
        jan = next(r for r in q2["zone_month"] if r["zone_id"] == z["zone_id"] and r["month"] == "2025-01")
        jun = next(r for r in q2["zone_month"] if r["zone_id"] == z["zone_id"] and r["month"] == "2025-06")
        change = (jun["coin_in"] / jun["days"]) / (jan["coin_in"] / jan["days"]) - 1
        zone_changes.append(f"{z['zone_name']} {change * 100:+.1f}%")
    entries.append(entry(
        "q2-answer", "Q2", "Q2: How did floor demand change?", "/q2",
        ["q2", "demand", "coin-in", "trend", "zones", "monthly", "traffic", "decline", "change"],
        f"""Q2 asks how floor demand changed. Monthly floor coin-in fluctuated rather than
        declining steadily: {monthly}. The highest month was {MONTH_NAMES[peak]} and the
        lowest {MONTH_NAMES[low]}; January to June changed
        {(coin['2025-06'] / coin['2025-01'] - 1) * 100:+.1f}%. Change in daily coin-in per
        zone, January to June: {'; '.join(zone_changes)}. Daily foot traffic and coin-in are
        strongly correlated in Back Forty (r = {q2['traffic_demand_corr']['Z-B40']:.3f}),
        which is association, not proof that traffic causes play.""",
        "q2.json zone_month, traffic_demand_corr",
    ))

    # Q3 ------------------------------------------------------------------
    manufacturers = sorted(ev["manufacturer"], key=lambda m: -m["tickets_per_machine"])
    mf_text = "; ".join(
        f"{m['manufacturer']} {m['tickets_per_machine']:.2f} fault repairs per machine "
        f"({m['tickets']} repairs, {m['downtime']:,.0f} downtime hours, {m['machines']} machines)"
        for m in manufacturers
    )
    entries.append(entry(
        "q3-answer", "Q3", "Q3: How much play was lost to downtime?", "/q3",
        ["q3", "downtime", "maintenance", "repairs", "tickets", "faults", "technician", "ridgeline", "exposure"],
        f"""Q3 covers maintenance and downtime. There were {s3['tickets']:,} operations tickets,
        of which {s3['fault_repairs']:,} were fault repairs; the others were installs, moves,
        scheduled maintenance and retirements. Total downtime was {s3['downtime_hours_all']:,.2f}
        hours ({s3['downtime_hours_fault']:,.2f} hours from fault repairs). An average fault
        repair waited {s3['avg_response_fault']:.2f} hours for a technician and took
        {s3['avg_repair_fault']:.2f} hours to repair. Direct fault repair cost was
        {usd(s3['direct_cost_fault'], 2)}. Estimated theoretical-win exposure from fault
        downtime was {usd(s3['est_exposure_fault'], 2)} — an upper-bound estimate, not actual
        lost revenue, because players can move to other machines. By manufacturer: {mf_text}.""",
        "q3.json summary, recommendations.json evidence",
    ))

    # Q4 ------------------------------------------------------------------
    full = q4["ranges"]["0-5"]
    shares = full["loss_share"]
    entries.append(entry(
        "q4-answer", "Q4", "Q4: What did tracked players wager, get back and net?", "/q4",
        ["q4", "players", "wager", "payout", "net", "losses", "concentration", "gini", "winners", "losers"],
        f"""Q4 covers tracked (loyalty-card) players, January–June. {full['players']:,} players
        wagered {usd(full['wager'], 2)} and were paid {usd(full['payout'], 2)}, a casino net of
        {usd(full['casino_net'], 2)} (theoretical win {usd(full['theo'], 2)}). {full['losers']:,}
        players lost, {full['winners']:,} won and {full['even']:,} broke even. Gross losses were
        {usd(full['gross_losses'], 2)} and winnings paid {usd(full['winnings_paid'], 2)}.
        Losses are concentrated: the top 1% of losing players account for {shares['1']:.2f}% of
        gross losses, the top 5% for {shares['5']:.2f}%, the top 10% for {shares['10']:.2f}% and
        the top 20% for {shares['20']:.2f}%. Gini coefficient of wagering {full['gini_wager']:.4f};
        of losses {full['gini_losses']:.4f}.""",
        "q4.json ranges (Jan–Jun)",
    ))

    # Q5 ------------------------------------------------------------------
    s5 = q5["summary"]
    tiers = []
    for tier in ("Base", "Gold", "Platinum"):
        rows = {r["month"]: r["points_per_face_dollar"] for r in q5["points_per_dollar_by_tier"] if r["tier_before"] == tier}
        before = sum(rows[m] for m in MONTHS[:4]) / 4
        after = sum(rows[m] for m in MONTHS[4:]) / 2
        tiers.append(f"{tier} {before:.1f} to {after:.1f}")
    jan = next(m for m in q5["monthly"] if m["month"] == "2025-01")
    jun = next(m for m in q5["monthly"] if m["month"] == "2025-06")
    entries.append(entry(
        "q5-answer", "Q5", "Q5: What did comps cost, and did anything change?", "/q5",
        ["q5", "comps", "loyalty", "cost", "points", "redemption", "face value", "tier", "may"],
        f"""Q5 covers the loyalty comp program. Actual economic comp cost was
        {usd(s5['economic_cost'], 2)} against a face value of {usd(s5['face_value'], 2)} (cost is
        {pct(s5['cost_to_face'])} of face value), from {s5['redemptions']:,} redemptions. From
        May 1 the points charged per comp dollar roughly halved in every tier (average points
        per face dollar, Jan–Apr to May–Jun: {'; '.join(tiers)}). Average monthly comp cost
        rose from {usd(ev['comp_monthly_cost_janapr'], 2)} (Jan–Apr) to
        {usd(ev['comp_monthly_cost_mayjun'], 2)} (May–Jun). Comp cost as a share of tracked
        theoretical win went from {jan['cost_pct_tracked_theo']:.2f}% in January to
        {jun['cost_pct_tracked_theo']:.2f}% in June. The data does not show whether the change
        was deliberate or whether it brought extra visits.""",
        "q5.json summary, monthly, points_per_dollar_by_tier",
    ))

    # Q6 ------------------------------------------------------------------
    selected = recs["selected"]
    plan = "; ".join(
        f"{a['action_type_id']} ({a['name']}) quantity {a['quantity']} at {usd(a['unit_cost'])} each = "
        f"{usd(a['total_cost'])}, lead time {a['lead_days']} days, {a['operating_days']} days of effect"
        for a in selected
    )
    entries.append(entry(
        "q6-plan", "Q6", "Q6: Which actions would we fund with $100,000?", "/q6",
        ["q6", "budget", "100,000", "fund", "actions", "allocation", "plan", "invest", "spend", "hold", "recommendation"],
        f"""Q6 asks which actions to fund with {usd(recs['budget'])} for the {recs['horizon_days']}
        days from July 1, 2025. The challenge allows up to 3 action types from the action
        catalogue; keeping money (A-HOLD, $0 unit cost) does not use a slot. The plan: {plan}.
        Total invested {usd(recs['spent'])}; preserved (A-HOLD) {usd(recs['preserved'])}.
        All quantities are within catalogue limits, and only A-COMP-PILOT uses an
        incompatibility group (comp_policy).""",
        "recommendations.json (from action_catalog)",
    ))
    entries.append(entry(
        "q6-why", "Q6", "Q6: Why these actions were chosen", "/q6",
        ["q6", "why", "reason", "technician", "tech shift", "inspect", "inspection", "comp pilot", "rationale"],
        f"""A-TECH-SHIFT adds one technician to a shift for 30 days to test whether more repair
        staffing cuts response time and downtime ({s3['tickets']:,} operations tickets,
        {s3['fault_repairs']:,} fault repairs, {s3['downtime_hours_all']:,.2f} downtime hours).
        Waiting for a technician is {pct(ev['tech_shift_response_share'])} of fault downtime, so
        even eliminating it would recover at most about {usd(ev['tech_shift_max_monthly_exposure'])}
        of estimated exposure per 30 days, less than its cost: it is a measured test, not an
        investment expected to pay back. A-INSPECT checks the {len(candidates)} Q1 candidates
        ({in_bf} in Back Forty) for faults and paytable issues before any costly relocation or
        replacement; the outcome is information, not a guaranteed finding. A-COMP-PILOT tests
        comp redemption pricing (which halved from May 1, see Q5) against a randomised control
        group. The remaining {usd(recs['preserved'])} is held until evidence supports more
        spending.""",
        "recommendations.json, q3.json, q1.json",
    ))
    entries.append(entry(
        "q6-measure", "Q6", "Q6: How we would know the actions worked", "/q6",
        ["q6", "measure", "success", "evaluation", "metrics", "control group", "baseline", "worked", "kpi"],
        f"""Each action is evaluated over the {recs['horizon_days']}-day horizon against a
        January–June baseline and a comparison group. A-TECH-SHIFT: average response time,
        repair duration and fault downtime hours on the staffed shift versus the same shift in
        the Jan–Jun baseline and versus unchanged shifts. A-INSPECT: number of faults and
        paytable issues found and corrected, then availability versus uninspected Back Forty
        machines. A-COMP-PILOT: incremental net revenue (theoretical win minus comp cost) and
        repeat visits per player, treatment versus a randomised control group stratified by
        tier. A-HOLD: funds released only when a test supports another investment.
        Qualifications: downtime hours are not automatically lost revenue; fluctuating coin-in
        does not prove a comp change will raise it; these are hypotheses to test, not
        guaranteed outcomes.""",
        "Q6 page",
    ))
    not_funded = "; ".join(f"{a['action_type_id']} ({a['name']}, {usd(a['total_cost'])})" for a in recs["alternatives"])
    entries.append(entry(
        "q6-not-funded", "Q6", "Q6: Actions considered but not funded", "/q6",
        ["q6", "not funded", "rejected", "alternatives", "replace", "wayfinding", "preventive", "promotion"],
        f"""Considered but not funded: {not_funded}. Replacing machines exceeds the budget or
        would put new titles in the same low-traffic location; only 3 action types are allowed;
        a promotion's benefit is not established causally; a floor-wide comp change is mutually
        exclusive with the pilot and cannot separate the pricing effect from seasonality.""",
        "recommendations.json alternatives",
    ))

    # Forecast model -------------------------------------------------------
    models = "; ".join(f"{m['name']}: MAE {usd(m['mae'])}" for m in forecast["models"])
    reg = next(m for m in forecast["models"] if m["id"] == "regression")
    entries.append(entry(
        "forecast", "Forecast", "Forecast model of daily coin-in", "/model",
        ["forecast", "model", "machine learning", "ml", "regression", "mae", "holdout", "prediction"],
        f"""A daily coin-in forecast was trained on {forecast['train'][0]} to {forecast['train'][1]}
        and tested on {forecast['holdout'][0]} to {forecast['holdout'][1]}. Holdout error: {models}.
        The calendar regression improves on the weekday average by {usd(reg['mae_gain_vs_weekday'])}
        MAE, but the 95% confidence interval ({usd(reg['gain_ci95'][0])} to {usd(reg['gain_ci95'][1])})
        includes zero, so the gain is not statistically conclusive. It is used for scheduling and
        as a measurement baseline, not to justify spending.""",
        "forecast.json",
    ))

    entries.extend(methodology_claims())
    return entries


if __name__ == "__main__":
    knowledge = {
        "generated_from": "casinoguard/public/data/*.json and Methodology.tsx verified claims",
        "data_release": load("meta")["data_release"],
        "entries": build(),
    }
    OUT.write_text(json.dumps(knowledge, indent=2) + "\n")
    print(f"wrote {OUT} ({len(knowledge['entries'])} entries)")
