"""spec/health.md. Mirrors packages/engine/src/health.ts exactly, including the canonical
evidenceHash serialization (P-14b: must be byte-identical to the TS implementation)."""

from __future__ import annotations
import hashlib
import math
from .types import (
    REQUEST_FINALIZE_VIEW,
    FLAG_PAUSED,
    FLAG_CODEHASH_CHANGED,
    FLAG_NAV_STALE,
    RedeemRequestRecord,
    HealthSnapshot,
)


def _percentile(sorted_secs: list[int], p: float) -> int:
    if len(sorted_secs) == 0:
        return 0
    idx = min(len(sorted_secs) - 1, math.ceil((p / 100) * len(sorted_secs)) - 1)
    return sorted_secs[max(0, idx)]


def build_request_finalize_snapshot(
    records: list[RedeemRequestRecord],
    at_block: int,
    ts: int,
    nav_per_share: int,
    drawdown_bps: int,
    codehash: str,
    expected_codehash: str,
    nav_stale: bool,
    paused: bool,
) -> HealthSnapshot:
    finalized = [r for r in records if r.status == "Finalized" and r.processedAt > 0]
    latencies_sec = sorted(r.processedAt - r.requestedAt for r in finalized)

    n = len(latencies_sec)
    p50 = _percentile(latencies_sec, 50)
    p90 = _percentile(latencies_sec, 90)
    max_sec = latencies_sec[-1] if n > 0 else 0

    flags = 0
    if paused:
        flags |= FLAG_PAUSED
    if codehash.lower() != expected_codehash.lower():
        flags |= FLAG_CODEHASH_CHANGED
    if nav_stale:
        flags |= FLAG_NAV_STALE

    evidence_hash = hash_evidence(records)

    return HealthSnapshot(
        fromBlock=at_block,
        toBlock=at_block,
        ts=ts,
        method=REQUEST_FINALIZE_VIEW,
        n=n,
        p50Sec=p50,
        p90Sec=p90,
        maxSec=max_sec,
        navPerShare=nav_per_share,
        drawdownBps=drawdown_bps,
        codehash=codehash,
        flags=flags,
        evidenceHash=evidence_hash,
    )


def hash_evidence(records: list[RedeemRequestRecord]) -> str:
    sorted_records = sorted(records, key=lambda r: r.id)
    lines = [
        f"{r.id}|{r.owner.lower()}|{r.receiver.lower()}|{r.shares}|{r.requestedAt}|{r.processedAt}|{r.status}"
        for r in sorted_records
    ]
    canonical = "\n".join(lines)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return "0x" + digest


def derive_health_cap(
    snapshot: HealthSnapshot,
    now_ts: int,
    max_stale_sec: int,
    mandate_lead_time_sec: int,
    drawdown_pause_threshold_bps: int,
    cap_mandate: int,
) -> int:
    # onchain-access-control skill, check 1 (default-deny): ts == 0 (never published) and a
    # future-dated ts (never legitimate) are both explicitly stale, not left to fall out of
    # the arithmetic. Mirrored in TS's deriveHealthCap and Solidity's HealthMath for
    # three-way parity (P-08); the Solidity version additionally needs this to avoid an
    # unsigned-subtraction underflow, which doesn't apply to Python's arbitrary-precision ints.
    stale = snapshot.ts == 0 or snapshot.ts > now_ts or (now_ts - snapshot.ts) > max_stale_sec
    hard_stop = stale or bool(snapshot.flags & FLAG_PAUSED) or bool(snapshot.flags & FLAG_CODEHASH_CHANGED)
    if hard_stop:
        return 0

    half_pause_threshold = drawdown_pause_threshold_bps // 2
    p90_exceeds_mandate = snapshot.p90Sec > mandate_lead_time_sec
    drawdown_elevated = snapshot.drawdownBps >= half_pause_threshold
    if p90_exceeds_mandate or drawdown_elevated:
        return cap_mandate // 2

    return cap_mandate
