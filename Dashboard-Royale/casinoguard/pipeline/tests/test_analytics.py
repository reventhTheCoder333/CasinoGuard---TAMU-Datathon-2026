"""Unit tests for the pure analysis helpers (no data files needed)."""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analytics as an  # noqa: E402


def test_bet_mix_factor_equal_bets_is_one():
    assert an.bet_mix_factor([200, 200, 200]) == pytest.approx(1.0)


def test_bet_mix_factor_matches_formula():
    b = np.array([100, 200, 300], dtype=float)
    assert an.bet_mix_factor(list(b)) == pytest.approx(np.mean(b ** 2) / np.mean(b) ** 2)
    assert an.bet_mix_factor(list(b)) > 1


def test_hold_z_zero_when_observed_equals_expected():
    gap, se, z = an.hold_z(coin_in=1000, theo=100, house_win=100, spins=10_000, payout_variance=4.0)
    assert gap == 0 and z == 0 and se == pytest.approx(math.sqrt(4.0 / 10_000))


def test_hold_z_sign_and_scale():
    # observed 5% vs expected 10% over 40,000 spins with variance 4 -> se = 0.01 -> z = -5
    gap, se, z = an.hold_z(coin_in=1000, theo=100, house_win=50, spins=40_000, payout_variance=4.0)
    assert gap == pytest.approx(-0.05) and se == pytest.approx(0.01) and z == pytest.approx(-5.0)


def test_hold_z_bet_mix_makes_test_more_conservative():
    _, _, z1 = an.hold_z(1000, 100, 50, 40_000, 4.0, factor=1.0)
    _, _, z2 = an.hold_z(1000, 100, 50, 40_000, 4.0, factor=1.5)
    assert abs(z2) < abs(z1)


def test_hold_z_handles_no_play():
    assert all(math.isnan(x) for x in an.hold_z(0, 0, 0, 0, 4.0))


def test_z_threshold_bonferroni():
    assert an.z_threshold(0.05) == pytest.approx(1.95996, abs=1e-4)
    assert an.z_threshold(0.05, 310) > an.z_threshold(0.05, 10) > an.z_threshold(0.05)


def test_binom_tail():
    assert an.binom_tail(6, 6) == pytest.approx(1 / 64)
    assert an.binom_tail(0, 6) == pytest.approx(1.0)


def test_classify_payout():
    assert an.classify_payout(-4.0, 3.77, 2.58) == "payout anomaly lead"
    assert an.classify_payout(-3.0, 3.77, 2.58) == "watch: payout below expected"
    assert an.classify_payout(0.5, 3.77, 2.58) == "within normal luck"
    assert an.classify_payout(4.0, 3.77, 2.58) == "holding above expected"
    assert an.classify_payout(float("nan"), 3.77, 2.58) == "insufficient data"


def test_zone_adjusted_scores_weakest_has_pct_zero():
    df = pd.DataFrame({
        "machine_id": ["a", "b", "c", "d"], "zone_id": ["Z1", "Z1", "Z1", "Z2"], "config_id": ["C"] * 4,
        "theo": [10, 20, 30, 40], "available_hours": [10, 10, 10, 10], "occupied_hours": [1, 2, 3, 4],
    })
    out = an.zone_adjusted_scores(df).set_index("machine_id")
    assert out.loc["a", "zone_rank"] == 1 and out.loc["a", "zone_pct"] == pytest.approx(0.0)
    assert out.loc["c", "zone_pct"] == pytest.approx(1.0)
    assert out.loc["a", "zone_score"] > out.loc["c", "zone_score"]
    assert out.loc["d", "zone_count"] == 1


def test_closure_windows_equal_whole_weeks():
    w = an.closure_windows("2025-03-03", "2025-04-07")
    assert w["length_days"] == 35 and w["whole_weeks"]
    assert w["before"] == ["2025-01-27", "2025-03-02"]
    assert w["during"] == ["2025-03-03", "2025-04-06"]
    assert w["after"] == ["2025-04-07", "2025-05-11"]


def test_window_stats_ratio_of_sums():
    d = pd.DataFrame({"gaming_date": ["2025-01-01", "2025-01-02"], "coin_in": [100.0, 300.0], "theo": [10.0, 30.0],
                      "occupied_hours": [1.0, 3.0], "available_hours": [10.0, 10.0], "entries": [10, 30], "coverage_minutes": [60, 120]})
    st = an.window_stats(d, ["2025-01-01", "2025-01-02"])
    assert st["coin_in_per_day"] == 200 and st["occupancy"] == pytest.approx(0.2)
    assert st["entries_per_hour"] == pytest.approx(40 / 3)  # ratio of sums, not mean of daily ratios


def test_diff_in_diff():
    assert an.diff_in_diff(100, 70, 100, 100) == pytest.approx(-30)
    assert an.diff_in_diff(100, 90, 100, 95) == pytest.approx(-5)


def test_scenario_and_break_even():
    s = an.scenario(1000, 1500)
    assert s["net"] == 500 and s["roi_pct"] == 50.0
    assert an.break_even_share(1000, 4000) == pytest.approx(25.0)
    assert an.break_even_share(1000, 0) == math.inf


def test_calendar_frame_and_detection_limit():
    cal = an.calendar_frame("2025-07-01", 30, {"2025-07-04"})
    assert len(cal) == 30 and cal.holiday.sum() == 1 and cal.iloc[0].dow == 1  # Jul 1 2025 is a Tuesday
    assert an.min_detectable_share(100, 1000, 25) == pytest.approx(2.0)
