# Earned Authority: tier and incident specification

Frozen before code, per PLAN_v3 §6. Transcribed with the Phase 0 fix applied: the demo tier
floor is raised to clear the vault's real `minDepositAssets` (100 units), which the original
plan's "$5 leash" numbers did not (`spec/DECISIONS.md`, "Additional gate not in the original
plan").

## 1. Tier schedule (part of the mandate; owner pre-commits it)

`timeUnit` is 60 seconds in demo mode, 86,400 (1 day) in production.

| Tier | Name | maxTx | maxVault | maxBps | approvalAbove | actions/day | minDwell (units) | minRiskUnits | peak required | min receipts |
|---|---|---|---|---|---|---|---|---|---|---|
| T0 | Probation | 120 | 150 | 10% | 60 | 4 | 10 | 5 | 60% of maxVault | 10 |
| T1 | Trusted | 300 | 400 | 25% | 150 | 8 | 20 | 30 | 60% | 20 |
| T2 | Established | 600 | 800 | 40% | 300 | 12 | 40 | 100 | 60% | 30 |
| T3 | Proven | 1000 | 1200 | 60% | 500 | 24 | none | none | none | none |

`hardCap` (account-level last line of defense) = 1200 in the demo build (was 50 in the
original plan — also below the vault minimum, same fix applied). All values in the vault's
native 18-decimal unit.

## 2. State (in StewardAccount, mirrored in the off-chain engine)

`tier`, `tierEnteredAt`, `riskAcc` (accumulated exposure-time), `peakExposure`,
`receiptsSinceEntry`, `incidentCount`, `lastIncidentAt`, `lastExposure`, `lastTs`.

Risk accrual is lazy and keeper-less: on every state-changing call,
`riskAcc += lastExposure * (now - lastTs)`, then `lastExposure` and `lastTs` are refreshed.
Views compute the current tier state on read.

## 3. Promotion predicate (deterministic; anyone may call `graduate()`)

Promote from tier `t` to `t+1` iff **all** hold:

1. `now - tierEnteredAt >= minDwell[t] * timeUnit`
2. `riskAcc / timeUnit >= minRiskUnits[t]`
3. `peakExposure >= peakRequired[t]` (the agent must actually have used the authority it holds)
4. `receiptsSinceEntry >= minReceipts[t]`
5. `incidentsSinceEntry == 0`
6. Not paused, mandate not expired, evidence not stale

`graduate()` resets `riskAcc`, `peakExposure`, `receiptsSinceEntry`, sets `tierEnteredAt`,
emits `Graduated(agent, fromTier, toTier, riskUnits, receipts)`. Model text is not an input.
The owner can veto nothing here because the owner already pre-committed the schedule; the
owner can still tighten or pause at any time, which is itself an incident.

## 4. Demotion and incidents (all observable on-chain)

| Incident | Effect |
|---|---|
| `LOOSEN_VETOED` (owner or guardian cancels the agent's loosening proposal) | Demote one tier |
| `OWNER_PAUSE` | Demote to T0 |
| `OVERCAP_GRACE_EXCEEDED` (exposure above capacity for longer than the grace period while the agent could have exited) | Demote to T0 |

Evidence-driven tightening by the guardian is **not** an incident: it is the system working.
Self-reported refusals (`logDecision` with `REFUSE`) are displayed but never used for tiering,
because a misbehaving agent would not report itself. Reverted transactions leave no on-chain
trace for contracts, so they are not used either; the verifier may display failed transactions
from RPC history as information only.

## 5. Effective limits

```
limit = min(tier limit, mandate ceiling, capacityCap, healthCap, hardCap)
```

Tier limits can never exceed mandate ceilings. This composes with `spec/accounting.md` §4 —
`capTier` there is `tier.maxVault` from this table.

## 6. ConductRegistry (per-agent record)

Factory-created accounts push updates (`report(...)`) on graduation, demotion and periodic
checkpoints. The registry stores per agent: accounts count, distinct owners count, total risk
units weighted by `min(exposure, tier maxVault)`, incident count, max tier reached, first seen,
clean-streak start.

`StewardFactory.createAccount(owner, agent, guardian, cfg)` reads `recordOf(agent)` and sets
`startTier = tierFor(record)`, capped by the owner's `maxStartTier`. A stranger starts at T0. A
record with enough distinct owners and clean risk units starts higher.

## 7. Anti-gaming, stated openly

- Idle time does not promote: risk units and peak exposure are required.
- Farming a record with your own funds costs real capital-time and real yield-exposure; the
  record shows notional and duration, so it is evidence, not a magic score.
- A record farmed across many self-owned accounts is limited by requiring a minimum
  `distinctOwners` above T1. Sybil owners are still possible; a delegator reads the numbers,
  and the registry exposes them.
- Owner interventions demote conservatively even when the owner's reason was unrelated to
  agent fault.

## 8. Reference test vectors

Canonical fixtures for the promotion predicate and demotion state machine live in
`/fixtures/tiers/*.json`, generated to cover: exact-boundary dwell/risk/peak/receipts values
(should promote), one-field-short values (should not promote), each incident type from each
tier, and a graduation immediately followed by an incident in the same block (must not
promote and demote in the same transaction — invariant O-12, `spec/accounting.md` cross-ref).
