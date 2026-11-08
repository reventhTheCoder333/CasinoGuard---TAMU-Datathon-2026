"""
Pure analysis helpers used by build_data.py.

Kept free of file I/O so each calculation can be unit-tested on small inputs
(see pipeline/tests/). Every function documents its formula and assumptions.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from statistics import NormalDist

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Luck vs payout anomaly (Q1)
# --------------------------------------------------------------------------


def bet_mix_factor(bet_options: list[float]) -> float:
    """Variance inflation from unequal bets, assuming each listed bet size is used equally often.

    With bets b_i, the hold over N spins is sum(b_i * (1 - m_i)) / sum(b_i), whose variance is
    var(m) * sum(b_i^2) / sum(b_i)^2 = var(m) / N * E[b^2] / E[b]^2. Equal bets give factor 1;
    any spread of bet sizes makes the factor larger, which makes the test more conservative.
    """
    b = np.asarray([x for x in bet_options if x > 0], dtype=float)
    if b.size == 0:
        return 1.0
    return float(np.mean(b ** 2) / np.mean(b) ** 2)


def hold_z(coin_in: float, theo: float, house_win: float, spins: float, payout_variance: float, factor: float = 1.0):
    """Standardised gap between observed and expected hold.

    expected hold = theo / coin_in (= 1 - configured RTP); observed hold = house_win / coin_in.
    SE(hold) = sqrt(payout_variance * factor / spins), the sampling error of the hold over `spins`
    plays given the game's published payout-multiplier variance. Returns (gap, se, z); negative z
    means the machine paid out more than its configuration predicts.
    """
    if coin_in <= 0 or spins <= 0 or payout_variance <= 0:
        return (math.nan, math.nan, math.nan)
    gap = house_win / coin_in - theo / coin_in
    se = math.sqrt(payout_variance * factor / spins)
    return (gap, se, gap / se)


def z_threshold(alpha: float, tests: int = 1) -> float:
    """Two-sided critical |z| with a Bonferroni correction for `tests` simultaneous machines."""
    return NormalDist().inv_cdf(1 - alpha / (2 * max(tests, 1)))


def binom_tail(k: int, n: int, p: float = 0.5) -> float:
    """P(X >= k) for X ~ Binomial(n, p): how unusual k below-theo months out of n would be."""
    if n <= 0:
        return math.nan
    return float(sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1)))


def classify_payout(z: float, z_flag: float, z_watch: float) -> str:
    if not np.isfinite(z):
        return "insufficient data"
    if z <= -z_flag:
        return "payout anomaly lead"
    if z <= -z_watch:
        return "watch: payout below expected"
    if z >= z_flag:
        return "holding above expected"
    return "within normal luck"


# --------------------------------------------------------------------------
# Location-adjusted ranking (Q1)
# --------------------------------------------------------------------------


def zone_adjusted_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Rank machines against the other machines in the same zone.

    Input columns: machine_id, zone_id, config_id, theo, available_hours, occupied_hours.
    theo/hr is first divided by the floor-wide median theo/hr of the machine's configuration, so
    machines with different payout settings can be compared inside one zone. Percentiles are then
    taken within the zone, and the score uses the same 0.6 / 0.4 weights as the team's Q1 score:
    zone_score = 0.6 * (1 - pct(theo/hr ratio)) + 0.4 * (1 - pct(occupancy)); higher = weaker.
    """
    d = df.copy()
    d["tph"] = d.theo / d.available_hours.replace(0, np.nan)
    d["occ"] = d.occupied_hours / d.available_hours.replace(0, np.nan)
    d["tph_ratio"] = d.tph / d.groupby("config_id")["tph"].transform("median")
    d["z_tp"] = d.groupby("zone_id")["tph_ratio"].rank(pct=True)
    d["z_op"] = d.groupby("zone_id")["occ"].rank(pct=True)
    d["zone_score"] = 0.6 * (1 - d.z_tp) + 0.4 * (1 - d.z_op)
    d["zone_rank"] = d.groupby("zone_id")["zone_score"].rank(ascending=False, method="first")
    d["zone_count"] = d.groupby("zone_id")["zone_score"].transform("count")
    # 0 = weakest in its zone, 1 = strongest
    d["zone_pct"] = (d.zone_rank - 1) / (d.zone_count - 1).replace(0, np.nan)
    return d[["machine_id", "tph_ratio", "zone_score", "zone_rank", "zone_count", "zone_pct"]]


# --------------------------------------------------------------------------
# Event windows (Q2 walkway closure)
# --------------------------------------------------------------------------


def closure_windows(first_closed: str, first_open: str) -> dict:
    """Equal-length before / during / after windows around a closure, in gaming dates.

    `first_closed` is the first gaming date affected; `first_open` the first gaming date after
    reopening. Equal lengths that are whole weeks keep the weekday mix identical in all windows.
    """
    s = date.fromisoformat(first_closed)
    e = date.fromisoformat(first_open)
    n = (e - s).days
    return {
        "length_days": n,
        "whole_weeks": n % 7 == 0,
        "before": [(s - timedelta(days=n)).isoformat(), (s - timedelta(days=1)).isoformat()],
        "during": [s.isoformat(), (e - timedelta(days=1)).isoformat()],
        "after": [e.isoformat(), (e + timedelta(days=n - 1)).isoformat()],
    }


def window_stats(daily: pd.DataFrame, win: list[str]) -> dict:
    """Ratio-of-sums stats for one window of daily zone rows.

    Columns: gaming_date, coin_in, theo, occupied_hours, available_hours, entries, coverage_minutes.
    """
    w = daily[(daily.gaming_date >= win[0]) & (daily.gaming_date <= win[1])]
    days = w.gaming_date.nunique()
    cov = w.coverage_minutes.sum() / 60 if "coverage_minutes" in w else 0
    return {
        "days": int(days),
        "coin_in_per_day": float(w.coin_in.sum() / days) if days else math.nan,
        "theo_per_day": float(w.theo.sum() / days) if days and "theo" in w else math.nan,
        "occupancy": float(w.occupied_hours.sum() / w.available_hours.sum()) if w.available_hours.sum() else math.nan,
        "entries_per_hour": float(w.entries.sum() / cov) if cov else math.nan,
    }


def pct_change(a: float, b: float) -> float:
    return (b / a - 1) * 100 if a and np.isfinite(a) and np.isfinite(b) else math.nan


def diff_in_diff(zone_before: float, zone_after: float, rest_before: float, rest_after: float) -> float:
    """Zone % change minus the rest-of-floor % change over the same windows (percentage points)."""
    return pct_change(zone_before, zone_after) - pct_change(rest_before, rest_after)


# --------------------------------------------------------------------------
# Budget scenarios (Q6)
# --------------------------------------------------------------------------


def scenario(cost: float, benefit: float) -> dict:
    """Net value and ROI of one scenario. ROI = (benefit - cost) / cost."""
    return {"benefit": round(float(benefit), 2), "net": round(float(benefit - cost), 2),
            "roi_pct": round(float((benefit - cost) / cost * 100), 1) if cost else None}


def break_even_share(cost: float, full_benefit: float) -> float:
    """Share of the full (high-scenario) benefit needed to recover the cost, in percent."""
    return float(cost / full_benefit * 100) if full_benefit > 0 else math.inf


# --------------------------------------------------------------------------
# Forecast use (decisions)
# --------------------------------------------------------------------------


def calendar_frame(start: str, days: int, holidays: set[str]) -> pd.DataFrame:
    """Future calendar features known in advance: weekday (Mon=0) and federal holiday flag."""
    dates = pd.date_range(start, periods=days, freq="D")
    return pd.DataFrame({"date": dates, "gaming_date": dates.strftime("%Y-%m-%d"), "dow": dates.day_of_week,
                         "holiday": [int(d.strftime("%Y-%m-%d") in holidays) for d in dates]})


def min_detectable_share(mae: float, mean_daily: float, days: int) -> float:
    """Rough floor-level detection limit: an effect smaller than the forecast's typical daily
    error, averaged over `days` independent-ish days (error / sqrt(days)), cannot be told apart
    from forecast noise. Returned as a share of mean daily coin-in, in percent."""
    return float(mae / math.sqrt(max(days, 1)) / mean_daily * 100)
