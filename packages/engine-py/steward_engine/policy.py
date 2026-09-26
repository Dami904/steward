"""spec/accounting.md section 6. Mirrors packages/engine/src/policy.ts exactly."""

from __future__ import annotations
from dataclasses import dataclass
from .types import (
    ALLOW,
    NEEDS_APPROVAL,
    REFUSE,
    OWNER_PAUSED,
    MANDATE_EXPIRED,
    PROPOSAL_INVALID,
    OVER_MAX_TX,
    OVER_CAPACITY,
    BELOW_RESERVE,
    STALE_EVIDENCE,
    ADVERSE_CLAIM,
    UNGROUNDED_CLAIM,
    RATE_LIMIT,
    MANDATORY_DERISK,
    ABOVE_APPROVAL_THRESHOLD,
    OK,
    reason_mask,
    Mandate,
    VaultReadState,
    PolicyResult,
)
from .accounting import compute_capacity, CapacityInputs


@dataclass
class DepositCheckInputs:
    amount: int
    mandate: Mandate
    vault: VaultReadState
    capacityInputs: CapacityInputs
    liquidAfter: int
    reserveAmt: int
    dailyActionsSoFar: int
    evidenceFresh: bool
    # spec/evidence.md section 3.5: flattened booleans from derive_evidence_flags/ground_claims,
    # same pattern as evidenceFresh. Informational only (see check_deposit).
    adverseClaimPresent: bool
    ungroundedClaimPresent: bool
    now: int
    mandateExpiry: int
    paused: bool


def check_deposit(inputs: DepositCheckInputs) -> PolicyResult:
    refuse_bits: list[int] = []
    result = compute_capacity(inputs.capacityInputs)

    if inputs.paused:
        refuse_bits.append(OWNER_PAUSED)
    if inputs.now > inputs.mandateExpiry:
        refuse_bits.append(MANDATE_EXPIRED)
    if inputs.amount < inputs.vault.minDepositAssets:
        refuse_bits.append(PROPOSAL_INVALID)
    if inputs.amount > inputs.mandate.maxTxUsdc:
        refuse_bits.append(OVER_MAX_TX)
    if inputs.amount > result.headroom:
        refuse_bits.append(OVER_CAPACITY)
    if inputs.liquidAfter < inputs.reserveAmt + inputs.mandate.minLiquidUsdc:
        refuse_bits.append(BELOW_RESERVE)
    if not inputs.evidenceFresh:
        refuse_bits.append(STALE_EVIDENCE)
    if inputs.dailyActionsSoFar >= inputs.mandate.maxActionsPerDay:
        refuse_bits.append(RATE_LIMIT)
    if result.overCap > 0:
        refuse_bits.append(MANDATORY_DERISK)

    # spec/evidence.md section 3.5: informational only, never itself a refuse reason — see the
    # matching comment in packages/engine/src/policy.ts's checkDeposit.
    info_bits: list[int] = []
    if inputs.adverseClaimPresent:
        info_bits.append(ADVERSE_CLAIM)
    if inputs.ungroundedClaimPresent:
        info_bits.append(UNGROUNDED_CLAIM)

    bits = [*refuse_bits, *info_bits]
    if len(refuse_bits) > 0:
        verdict = REFUSE
    elif inputs.amount > inputs.mandate.approvalAbove:
        verdict = NEEDS_APPROVAL
        bits.append(ABOVE_APPROVAL_THRESHOLD)
    else:
        verdict = ALLOW
        bits.append(OK)

    return PolicyResult(
        verdict=verdict,
        reasons=reason_mask(bits),
        capacity=result.capacity,
        headroom=result.headroom,
        overCap=result.overCap,
        bindingTerm=result.bindingIndex,
    )


@dataclass
class RedeemCheckInputs:
    shares: int
    previewAssets: int
    vault: VaultReadState
    dailyActionsSoFar: int
    maxActionsPerDay: int


@dataclass
class RedeemResult:
    verdict: int
    reasons: int


def check_redeem(inputs: RedeemCheckInputs) -> RedeemResult:
    bits: list[int] = []
    if inputs.previewAssets < inputs.vault.minRedeemAssets:
        bits.append(PROPOSAL_INVALID)
    if inputs.dailyActionsSoFar >= inputs.maxActionsPerDay:
        bits.append(RATE_LIMIT)

    if len(bits) > 0:
        return RedeemResult(verdict=REFUSE, reasons=reason_mask(bits))
    return RedeemResult(verdict=ALLOW, reasons=reason_mask([OK]))
