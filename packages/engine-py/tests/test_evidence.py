import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from steward_engine.evidence import (
    RawClaim,
    ground_claims,
    corroborate,
    derive_evidence_flags,
    hash_claim_set,
    quiet_window_ok,
    TimedClaim,
)

SRC = "The vault may pause redemptions at the operator's discretion during stress."


def make_claim(**overrides):
    base = dict(
        type="PAUSE",
        polarity="ADVERSE",
        quote="pause redemptions at the operator's discretion",
        severity="HIGH",
        sourceUrl="https://ixs.example/notice",
    )
    base.update(overrides)
    return RawClaim(**base)


def test_ground_claims_drops_a_claim_whose_quote_is_not_a_verbatim_substring():
    grounded, ungrounded_count = ground_claims(SRC, [make_claim(quote="this text is not in the source")])
    assert len(grounded) == 0
    assert ungrounded_count == 1


def test_corroborate_is_symmetric():
    a, _ = ground_claims(SRC, [make_claim()])
    b, _ = ground_claims(SRC, [make_claim()])

    forward = corroborate(a, b)
    backward = corroborate(b, a)

    def statuses_of(claims):
        return ",".join(sorted(c.status for c in claims))

    assert statuses_of(forward) == statuses_of(backward)
    assert all(c.status == "CORROBORATED" for c in forward)


def test_derive_evidence_flags_ignores_favorable_and_neutral():
    a, _ = ground_claims(SRC, [make_claim(polarity="FAVORABLE")])
    b, _ = ground_claims(SRC, [make_claim(polarity="FAVORABLE")])
    flags = derive_evidence_flags(corroborate(a, b))
    assert flags.corroboratedSevereAdverse is False
    assert flags.singlePathAdverse is False


def test_hash_claim_set_is_order_independent():
    a, _ = ground_claims(SRC, [make_claim()])
    assessed = corroborate(a, [])
    reversed_assessed = list(reversed(assessed))
    assert hash_claim_set(assessed) == hash_claim_set(reversed_assessed)


def test_hash_claim_set_of_empty_set_is_well_known_sha256_empty_digest():
    assert hash_claim_set([]) == "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def test_quiet_window_ok():
    now = 1_000_000
    window_sec = 3600
    assert quiet_window_ok([TimedClaim("ADVERSE", now - 100)], now, window_sec) is False
    assert quiet_window_ok([TimedClaim("ADVERSE", now - window_sec)], now, window_sec) is False
    assert quiet_window_ok([TimedClaim("ADVERSE", now - window_sec - 1)], now, window_sec) is True
    assert quiet_window_ok([TimedClaim("FAVORABLE", now)], now, window_sec) is True
    assert quiet_window_ok([], now, window_sec) is True
