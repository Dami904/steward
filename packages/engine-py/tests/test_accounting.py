import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.accounting import evidence_health_multiplier_bps
from steward_engine.types import EvidenceState

# Mirrors packages/engine/test/accounting.test.ts exactly. spec/accounting.md section 4's
# health formula had zero test coverage in either language until the Phase 3 reliability
# review found it — deleting any branch below must fail one of these tests.


def base_evidence(**overrides):
    defaults = dict(
        stale=False,
        corroboratedSevereAdverse=False,
        singlePathAdverse=False,
        observedLatencyDays=0,
        drawdownBps=0,
        drawdownPauseThresholdBps=2000,
    )
    defaults.update(overrides)
    return EvidenceState(**defaults)


def test_clean_evidence_state_is_unrestricted():
    assert evidence_health_multiplier_bps(base_evidence(), 5) == 10000


def test_stale_evidence_zeroes_health():
    assert evidence_health_multiplier_bps(base_evidence(stale=True), 5) == 0


def test_corroborated_severe_adverse_claim_zeroes_health():
    assert evidence_health_multiplier_bps(base_evidence(corroboratedSevereAdverse=True), 5) == 0


def test_corroborated_severe_adverse_wins_over_single_path_also_true():
    evidence = base_evidence(corroboratedSevereAdverse=True, singlePathAdverse=True)
    assert evidence_health_multiplier_bps(evidence, 5) == 0


def test_single_path_adverse_claim_halves_health():
    assert evidence_health_multiplier_bps(base_evidence(singlePathAdverse=True), 5) == 5000


def test_observed_latency_exceeding_eff_lead_days_halves_health():
    evidence = base_evidence(observedLatencyDays=10)
    assert evidence_health_multiplier_bps(evidence, 5) == 5000


def test_drawdown_at_or_above_half_pause_threshold_halves_health():
    evidence = base_evidence(drawdownBps=1000, drawdownPauseThresholdBps=2000)
    assert evidence_health_multiplier_bps(evidence, 5) == 5000


def test_drawdown_at_or_above_full_pause_threshold_zeroes_health():
    evidence = base_evidence(drawdownBps=2000, drawdownPauseThresholdBps=2000)
    assert evidence_health_multiplier_bps(evidence, 5) == 0
