# Accounting and policy specification

Frozen before code. This governs the deterministic policy engine — the only
thing that decides what an agent proposal is allowed to do. The model never reads this file's
outputs and cannot influence them except through evidence claims (§4).

Values the original plan left as placeholders were pinned by checking the real vault
("Phase 0" below means that verification).

## 1. Units and rounding

- Internal unit: the token's smallest unit, integers only (`uint128` in Solidity, `bigint` in
  TypeScript, `int` in Python — never floats, never `number`/`float` for money).
- Decimals are pinned to **18** for both the vault share token and its underlying asset
  (`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`), confirmed on-chain in Phase 0. The engine
  refuses to run if a live `decimals()` read disagrees with this pinned value.
- Rounding always reduces risk:
  - Capacity and recognised value round **down**.
  - Reserve and haircuts round **up**.
  - Fees round **down** (owner's favor).
  - Cost-basis attribution rounds in the owner's favor.
- All basis-point (bps) fields are `uint16`, out of 10,000.

## 2. Recognised position value

```
navMark        = shares * navPerShare
h_issuer       = mandate.issuerHaircutBps (+ step per adverse claim, spec/evidence.md)
h_latency      = min(mandate.latencyHaircutMaxBps, mandate.latencyHaircutBpsPerDay * effLeadDays)
recognisedPos  = floor(navMark * (10000 - h_issuer) * (10000 - h_latency) / 1e8)
```

The agent never counts the vault position as cash. Only `recognisedPos` enters treasury value
for capacity. `navPerShare` is read from the vault's `pricePerShare()` (or equivalent) —
Phase 0 confirmed this is **operator-attested** (`setNAV`, `NAV_MANAGER_ROLE`), not computed
on-chain from real asset prices. Treat it as evidence with `maxNavChangeBps = 5000` as the
vault's own sanity bound; the Health Feed's `NAV_STALE` / `CODEHASH_CHANGED` flags (§health.md)
are the mitigation for this being a trusted input.

## 3. Liquidity ladder

```
effLeadDays = max(mandate.leadFloorDays, ceil(q90Latency * mandate.latencySafety))
              q90Latency from on-chain request/finalize history if n >= 5,
              else max(observed) * 2 if n >= 1,
              else mandate.leadFloorDays
reserve     = minLiquid + sum(obligations with due < now + effLeadDays + bufferDays)   (round up)
redeemBy(o) = o.due - effLeadDays - bufferDays
```

Phase 0 note: the vault's redemption method is `REQUEST_FINALIZE_VIEW` (§health.md), not
`OWN_REQUESTS` — full history is readable, and at read time `n = 6` finalized requests, which
already clears the `n >= 5` bar. `q90Latency` should currently resolve to a measured value, not
`leadFloorDays`. Re-derive at each engine run; do not hardcode the Phase 0 sample.

## 4. Capacity

```
treasury    = liquid + recognisedPos + finalizedNotYetClaimed + pendingRedemptionExpected (haircut)
capMandate  = min(maxBps * treasury / 10000, maxVaultUsdc)
capLiquid   = max(0, treasury - reserve)
capTier     = tier.maxVault  (spec/tiers.md §5)
capHealth   = healthCap      (spec/health.md §3, tighten-only)
health      = 0    if stale evidence, codehash mismatch, paused, drawdown >= pause threshold,
                      or any corroborated severe adverse claim
              0.5  if single-path adverse claim, observed latency > effLeadDays, or half-threshold drawdown
              1    otherwise
capacity    = floor(min(capMandate, capLiquid, capTier, capHealth, capacityCapOnChain) * health)
headroom    = max(0, capacity - exposure);  overCap = max(0, exposure - capacity)
```

The binding term (whichever of `capMandate`/`capLiquid`/`capTier`/`capHealth`/
`capacityCapOnChain` was smallest) is recorded in every receipt and shown in the UI —
this is the "effective limits" composition of `spec/tiers.md` §5, extended with the health
cap from `spec/health.md`.

## 5. Verdicts and reason codes

Verdicts: `ALLOW`, `ALLOW_CLAMPED` (mandate flag), `NEEDS_APPROVAL`, `REFUSE`.

Reason bitmask (order fixed — this is the canonical encoding other implementations must
match bit-for-bit):

```
0  OK
1  HOLD_NOOP
2  MANDATE_INVALID
3  MANDATE_EXPIRED
4  AGENT_MISMATCH
5  TARGET_NOT_ALLOWED
6  OVER_CAPACITY
7  OVER_MAX_TX
8  BELOW_RESERVE
9  STALE_EVIDENCE
10 CODEHASH_CHANGED
11 DRAWDOWN_PAUSE
12 ADVERSE_CLAIM
13 UNGROUNDED_CLAIM
14 RATE_LIMIT
15 ABOVE_APPROVAL_THRESHOLD
16 HARD_CAP
17 PROPOSAL_INVALID
18 MODEL_FAILED_OUTPUT
19 OWNER_PAUSED
20 MANDATORY_DERISK
```

## 6. Rules (asymmetric authority)

- `DEPOSIT(x)`: needs `x <= headroom`, `x <= maxTx`, `liquid - x >= reserve + minLiquid`, rate
  limit, fresh evidence, deposit hard cap, **and `x >= vault.minDepositAssets`** (Phase 0:
  currently 100 units, which the original plan didn't account for; the engine must reject a
  proposal below this floor with `PROPOSAL_INVALID` before it ever reaches the chain). Above
  `approvalAbove`, `NEEDS_APPROVAL`.
- `REQUEST_REDEEM(x)`: risk-reducing, allowed up to the position, subject only to the rate
  limit, **and `previewRedeem(x) >= vault.minRedeemAssets`** (same Phase 0 floor). Allowed even
  when paused or expired.
- `HOLD`: always allowed and always logged.
- `overCap > 0` triggers `MANDATORY_DERISK`. If the model does not propose the exit, the Risk
  Sentinel proposes it deterministically.
- Increasing exposure is judged only on mandate plus deterministic evidence, never on model
  rationale text or on an uncorroborated favorable claim.

## 7. Off-chain invariants (each is a test)

P-01 target and token are in the allowlist. P-02 post-deposit liquid at least reserve +
minLiquid. P-03 post-deposit exposure at most capacity. P-04 no numeric limit is read from
model output. P-05 `REQUEST_REDEEM` never increases exposure. P-06 invalid or expired mandate
allows only exit or hold. P-07 stale evidence gives capacity 0. P-08 identical `(mandate,
evidence, claims, proposal, policyVersion, tierState, healthSnapshot)` gives a byte-identical
verdict in the TypeScript and Python implementations (extends the original P-08 to cover the
v3 additions). P-09 favorable claims never increase capacity. P-10 a claim without a verbatim
source quote is dropped. P-11 rounding never favors risk. **P-12** a deposit or redeem below
the vault's `minDepositAssets`/`minRedeemAssets` is rejected with `PROPOSAL_INVALID` before any
on-chain call is attempted (Phase 0 addition).

## 8. Canonical encoding

`policyInput` (the bytes emitted in every `Decision` event) is the ABI-encoded tuple, in this
field order, so all three implementations (TS, Python, Solidity) produce byte-identical output
for identical input:

```
(mandateHash: bytes32, evidenceSnapshotId: bytes32, proposalAction: uint8,
 proposalAmount: uint128, verdict: uint8, reasonMask: uint32,
 tier: uint8, riskUnits: uint128, peakExposure: uint128, receiptsSinceEntry: uint32,
 incidentCount: uint32, healthSnapshotId: uint64, capacityBindingTerm: uint8)
```

`capacityBindingTerm` enum: `0=capMandate, 1=capLiquid, 2=capTier, 3=capHealth,
4=capacityCapOnChain`.

Fixtures and differential tests live in `/fixtures` and are consumed identically by
`packages/engine` (TypeScript) and `packages/engine-py` (Python) — see
`spec/tiers.md` and `spec/health.md` for the two pieces of state this file's formulas depend
on but doesn't define.
