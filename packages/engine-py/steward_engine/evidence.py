"""spec/evidence.md. Mirrors packages/engine/src/evidence.ts exactly. Pure functions only —
no network call lives here."""

from __future__ import annotations
import hashlib
import re
from dataclasses import dataclass

REDEMPTION_GATING = "REDEMPTION_GATING"
REDEMPTION_DELAY = "REDEMPTION_DELAY"
UNDERLYING_CHANGE = "UNDERLYING_CHANGE"
NAV_METHOD_CHANGE = "NAV_METHOD_CHANGE"
YIELD_CHANGE = "YIELD_CHANGE"
CUSTODY_CHANGE = "CUSTODY_CHANGE"
PAUSE = "PAUSE"
REGULATORY = "REGULATORY"
OTHER = "OTHER"

ADVERSE = "ADVERSE"
FAVORABLE = "FAVORABLE"
NEUTRAL = "NEUTRAL"

LOW = "LOW"
MEDIUM = "MEDIUM"
HIGH = "HIGH"


@dataclass
class RawClaim:
    type: str
    polarity: str
    quote: str
    severity: str
    sourceUrl: str


@dataclass
class GroundedClaim:
    type: str
    polarity: str
    quote: str
    severity: str
    sourceUrl: str
    matchStart: int
    matchEnd: int


@dataclass
class AssessedClaim:
    type: str
    polarity: str
    quote: str
    severity: str
    sourceUrl: str
    matchStart: int
    matchEnd: int
    status: str  # "CORROBORATED" | "SINGLE"


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def ground_claims(source_text: str, claims: list[RawClaim]) -> tuple[list[GroundedClaim], int]:
    normalized_source = normalize_whitespace(source_text)
    grounded: list[GroundedClaim] = []
    ungrounded_count = 0

    for claim in claims:
        normalized_quote = normalize_whitespace(claim.quote)
        match_start = normalized_source.find(normalized_quote) if len(normalized_quote) > 0 else -1
        if match_start == -1:
            ungrounded_count += 1
            continue
        grounded.append(
            GroundedClaim(
                type=claim.type,
                polarity=claim.polarity,
                quote=claim.quote,
                severity=claim.severity,
                sourceUrl=claim.sourceUrl,
                matchStart=match_start,
                matchEnd=match_start + len(normalized_quote),
            )
        )

    return grounded, ungrounded_count


def corroborate(a: list[GroundedClaim], b: list[GroundedClaim]) -> list[AssessedClaim]:
    used_b: set[int] = set()
    result: list[AssessedClaim] = []

    for claim_a in a:
        matched = False
        for j, claim_b in enumerate(b):
            if j in used_b:
                continue
            overlaps = claim_a.matchStart < claim_b.matchEnd and claim_b.matchStart < claim_a.matchEnd
            if claim_b.type == claim_a.type and claim_b.polarity == claim_a.polarity and overlaps:
                used_b.add(j)
                matched = True
                break
        result.append(_assessed(claim_a, "CORROBORATED" if matched else "SINGLE"))

    for j, claim_b in enumerate(b):
        if j in used_b:
            continue
        result.append(_assessed(claim_b, "SINGLE"))

    return result


def _assessed(c: GroundedClaim, status: str) -> AssessedClaim:
    return AssessedClaim(
        type=c.type,
        polarity=c.polarity,
        quote=c.quote,
        severity=c.severity,
        sourceUrl=c.sourceUrl,
        matchStart=c.matchStart,
        matchEnd=c.matchEnd,
        status=status,
    )


@dataclass
class EvidenceFlags:
    corroboratedSevereAdverse: bool
    singlePathAdverse: bool


def derive_evidence_flags(claims: list[AssessedClaim]) -> EvidenceFlags:
    corroborated_severe_adverse = False
    single_path_adverse = False

    for claim in claims:
        if claim.polarity != ADVERSE:
            continue
        if claim.severity == HIGH and claim.status == "CORROBORATED":
            corroborated_severe_adverse = True
        else:
            single_path_adverse = True

    return EvidenceFlags(
        corroboratedSevereAdverse=corroborated_severe_adverse,
        singlePathAdverse=single_path_adverse,
    )


def _quote_hash(quote: str) -> str:
    return hashlib.sha256(normalize_whitespace(quote).encode("utf-8")).hexdigest()


def hash_claim_set(claims: list[AssessedClaim]) -> str:
    def sort_key(c: AssessedClaim) -> str:
        return f"{c.sourceUrl}|{c.type}|{c.polarity}|{c.quote}"

    sorted_claims = sorted(claims, key=sort_key)
    lines = [
        f"{c.type}|{c.polarity}|{c.severity}|{c.status}|{_quote_hash(c.quote)}"
        for c in sorted_claims
    ]
    canonical = "\n".join(lines)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return "0x" + digest


@dataclass
class TimedClaim:
    polarity: str
    observedAt: int


def quiet_window_ok(claims: list[TimedClaim], now: int, window_sec: int) -> bool:
    cutoff = now - window_sec
    for claim in claims:
        if claim.polarity == ADVERSE and cutoff <= claim.observedAt <= now:
            return False
    return True
