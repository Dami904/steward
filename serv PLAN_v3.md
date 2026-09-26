# STEWARD v3: earned authority, measured vaults, verifiable conduct

Plan of record for the OpenServ SERV Hackathon Edition 01, RWA Vaults track (IXS). Written Sunday Sept 20 2026.
Builds on PLAN_v2.md. Sections marked "carried over" keep their v2 specification; this file specifies everything that changes or is new.
Labels: VERIFIED (read in an official or partner source), UNVERIFIED (must be checked in Phase 0).

---

## 0. Read first

v2 scored about 65/100 on the idea-ceiling rubric. Its weakness: the on-chain envelope is a crowded pattern, so its category-shaped part was only the replayable receipts.

v3 adds two mechanisms that each make something knowable that was only asserted before, and it keeps every v2 principle:

1. **Earned Authority:** an agent's limits are not configured constants. They start tiny and can only lengthen through a deterministic, on-chain, replayable record of what the agent actually did with its authority. Any incident shortens the leash immediately.
2. **Vault Health Feed:** a vault's real time-to-cash is measured from chain data, published with the method and sample size, and consumed by accounts in tighten-only mode. Vendor claims stop being the input to sizing decisions.
3. **Public honeypot:** real (small) money at stake, a public invitation to break the agent, and published results.

**Pitch (one sentence):** an AI that manages your USDC starts on a $5 leash that only a verifiable record can lengthen, and the vault's liquidity is measured on-chain instead of taken on faith.
**Demo contrast that lands:** same request, two agents. The stranger's transaction reverts. The agent with a proven record succeeds. Anyone can replay why.

Projected score on the same rubric: **91/100** (range 76 to 91 depending on gates), section 3. That number is my judgment of the idea as specified, not a measurement, and it holds only if the listed deliverables ship.

---

## 1. Principles preserved (and how v3 keeps each)

| # | Principle | Where v3 enforces it |
|---|---|---|
| P1 | AI interprets reality, deterministic code controls money | The model still emits only a typed proposal and structured claims. Tier promotion, feed consumption and every limit are deterministic. |
| P2 | Monotone envelope, asymmetric authority (agent may only tighten alone) | Graduation is not the agent's decision: it is a public function that succeeds only when an owner-pre-committed predicate holds on-chain. The feed can only tighten. Demotion is immediate. |
| P3 | Receipt-bound and replayable from chain data | Receipts now include the tier, risk-units and feed snapshot id. Graduation and demotion are replayable events. |
| P4 | Quote-grounded, corroborated evidence; adverse-only auto-action | Unchanged. Favorable claims still never loosen anything. |
| P5 | Spec-first, differential tests, honesty tables | The graduation predicate and health computation join the three-way differential suite. `LIVE.md` keeps the "real vs simulated" table. |
| P6 | Real funds, small, hard-capped, unaudited disclosure | Unchanged. The honeypot pot is capped and lost-money-tolerable. |
| P7 (new, derived) | Authority is earned from verifiable evidence, never asserted | Any loosening comes from an on-chain-provable predicate or from the owner. Never from model text, never from the feed. |

---

## 2. Alternatives pass (idea-ceiling discipline)

Candidates for the RWA Vaults track, scored on the same six checks. All numbers are my estimates.

| # | Candidate | Est. | Why |
|---|---|---|---|
| 1 | Yield-optimizer agent (LLM picks a vault, calls an API, dashboard) | 38 | Optimization. No enforcement, no verification, crowded. |
| 2 | Steward v1 (mandate agent, off-chain enforcement) | 45 | Optimization wrapper. Loses to stolen-key thought experiment. |
| 3 | Steward v2 (contract envelope + replayable receipts) | 65 | Verification layer is category-shaped; enforcement is a crowded pattern. |
| 4 | Vault Health Feed alone | 60 | Category-shaped data primitive. Standalone it is a data tool; the agent and SERV are not central; stakes moderate. |
| 5 | Earned Authority alone | 63 | Reputation-gated access exists in prior art; without the vault domain the stakes are abstract. |
| 6 | **v3 = 3 + 4 + 5 + honeypot** | **91 (target)** | Two independent category-shaped mechanisms compose: earned authority needs measured liquidity to be meaningful, and the feed needs a consumer with real stakes. |

Decision record (write to `spec/DECISIONS.md`): chosen candidate 6. Tradeoff accepted: breadth and Phase 0 dependence. Fallback if gates fail: candidate 3 with candidate 4 as the emphasis, projected about 76.
The skill says respect a deliberate choice of the safe version. This is your call. The plan only asks that it be made knowingly.

---

## 3. Ceiling check v3, with score and conditions

| Check | Weight | v2 | v3 target | Earned by (deliverable) | Cost if it slips |
|---|---|---|---|---|---|
| 1 Deletion test | 25 | 14 | 22 | Delete Earned Authority: limits become arbitrary constants nobody can justify. Delete the feed: sizing rests on a vendor claim. Delete receipts: conduct is unverifiable. Contract tests C7, feed recompute C8, receipts C2, prior-art table in README | Feed falls back to own-request sampling: -3. Mode B only: -4. Direct prior art found: -3 |
| 2 Pitch | 15 | 10 | 14 | Recorded two-agent same-request demo with real graduation history on chain | No graduation history: -3 |
| 3 Matters outside the event | 15 | 11 | 14 | Public feed URL and npm package; verifier URL; **measurement report** of vault claims vs measured behavior, useful to IXS, Compass and any agent operator whether or not the event exists | No report: -2 |
| 4 Reframe pass | 20 | 13 | 18 | Mechanism pointed at a relationship (agent and its owners), consumed by contracts: factory sets a new account's start tier from the agent's record; account reads the feed; a second independent reference agent consumes the feed | No consumer shipped: -4 |
| 5 Real stakes | 15 | 11 | 14 | Honeypot with real bounty and published results | Not shipped: -4 |
| 6 Discipline | 10 | 6 | 9 | Alternatives table (section 2), decision record, kill criteria (section 4) | No record: -2 |
| **Total** | 100 | 65 | **91** | | |

Sensitivity: if Mode A fails and the feed has no readable history, expect roughly 76. If the honeypot and consumers ship but the vault behavior is unfavorable, roughly 84.
Unproven by design: external adoption. The plan names who would rely on it (delegators, other agents, IXS, Compass, auditors) and ships one working consumer, but it cannot claim adoption inside the event.

---

## 4. Prior art, differentiation, and kill criteria

### 4.1 Prior art found (limited search; not exhaustive)
- **WAIaaS REPUTATION_THRESHOLD policy:** queries an agent's ERC-8004 reputation score and blocks transactions below a threshold. A binary gate from counterparty feedback.
- **Warden (AtmegaBuzz):** off-chain TypeScript plus on-chain Solidity spending limits via EIP-7702, with audit logs.
- **Phalnx / agentshield (Solana):** on-chain policy config, rolling spend caps, per-action session authority, audit records, and risk-reducing actions (closing positions, decreasing exposure) exempt from spend limits, which is the same asymmetry idea as P2.
- **AgentKit and similar TEE wallets:** per-transaction caps, session caps, allowlists.
- **Others:** agentctl, imprest, Mandate skill, Hermod (guardrails plus audit logs), and a crowded Solana field of on-chain agent spending vaults: AgentSafe, SolAgent Pay (session PDA with budget, allowlist, TTL and a payment event trail), AgentGuard Protocol, Oculus, seedless-agent-wallet.
- **RWA side:** NAV oracle feeds exist (Chainlink-style), and RedStone Settle targets instant liquidation of RWAs whose redemption takes 30 to 180 days. I found no public feed of measured per-vault redemption latency.
- ERC-7540 standardizes async request/claim vaults, so request events exist on compliant vaults; fulfillment logging is implementation-specific.

### 4.2 What is different
| Existing | Steward v3 |
|---|---|
| Limits are configured constants | Limits are earned tiers computed from replayable on-chain exposure history, demoted on incidents |
| Reputation is a score from counterparty feedback, used as a gate | Authority derives from the account's own receipted exposure-time and interventions, not from subjective feedback, and moves limits (not just allow/deny) |
| Audit logs the operator holds | Policy inputs and verdicts are emitted on-chain; verification needs no operator database |
| NAV oracles say what a share is worth | Health feed says how long getting cash out actually takes, recomputable from logs |

Honest statement: on-chain spending limits, audit trails, risk-reducing-action exemptions and reputation-conditioned access as concepts are all established. Most of the field is on Solana; this build is EVM and RWA-vault specific, which narrows the overlap but is not itself a moat. The claim is the specific mechanism (earned tiers from replayable exposure-time, consumed by a factory) and the measured-liquidity feed. Novelty is unproven beyond a handful of searches, which is why check 1 is scored 22 and not higher.

### 4.3 Kill criteria (decide in Phase 0, record in DECISIONS.md)
- If a directly equivalent "graduated on-chain authority from receipted exposure" is found: make the Vault Health Feed the primary story and shrink Earned Authority to an internal safety feature.
- If the vault exposes no readable request/fulfillment history and own-request sampling gives n below 3: downgrade the feed to a secondary component and say so in the README.
- If Mode A (contract depositor) fails: ship v2 scope in Mode B; tiers become off-chain and the score cap is about 76. State enforcement level plainly.

---

## 5. Architecture v3

```
 Owner -- pre-commits tier schedule (mandate) --> StewardFactory --reads--> ConductRegistry (per-agent record)
                                                     | creates
                                                     v
 Guardian (tighten/pause) --> StewardAccount <-- Agent (typed actions)          
                                | holds USDC + shares         ^
      tier state: riskUnits, peak, incidents, dwell           | typed proposal only
      tighten-only reads  <--- VaultHealthFeed <--- Reporter (indexer over vault logs)
                                | Decision events (policyInput, tier, feed id)
                                v
   Verifier / Simulate / UI / Honeypot leaderboard        SERV: reasoner + claim extraction (v2)
```

Components (new in bold): StewardAccount (v2 + tiers), StewardFactory (v2 + registry read), **ConductRegistry**, **VaultHealthFeed**, **health indexer and reporter**, verifier (v2 + tier and health replay), **honeypot**.

---

## 6. Earned Authority specification

### 6.1 Tier schedule (part of the mandate; owner pre-commits it)
Example configuration for the demo (USDC; tunable, and production values will differ). `timeUnit` is 60 seconds in demo mode and 86,400 in production, so graduation can be shown live and still be honest about real schedules.

| Tier | Name | maxTx | maxVault | maxBps | approvalAbove | actions/day | minDwell (units) | minRiskUnits | peak required | min receipts |
|---|---|---|---|---|---|---|---|---|---|---|
| T0 | Probation | 5 | 5 | 10% | 2 | 4 | 10 | 5 | 60% of maxVault | 10 |
| T1 | Trusted | 15 | 15 | 25% | 5 | 8 | 20 | 30 | 60% | 20 |
| T2 | Established | 30 | 30 | 40% | 10 | 12 | 40 | 100 | 60% | 30 |
| T3 | Proven | 50 | 50 | 60% | 20 | 24 | none | none | none | none |

The account-level `hardCap` remains the last line of defense (for example 50 total in the demo build).

### 6.2 State (on-chain, in StewardAccount)
`tier`, `tierEnteredAt`, `riskAcc` (accumulated exposure-time), `peakExposure`, `receiptsSinceEntry`, `incidentCount`, `lastIncidentAt`, `lastExposure`, `lastTs`.
Risk accrual is lazy and keeper-less: on every state-changing call, `riskAcc += lastExposure * (now - lastTs)`, then `lastExposure` and `lastTs` are refreshed. Views compute the current tier state on read.

### 6.3 Promotion predicate (deterministic; anyone may call `graduate()`)
Promote from tier t to t+1 iff all hold:
1. `now - tierEnteredAt >= minDwell[t] * timeUnit`
2. `riskAcc / timeUnit >= minRiskUnits[t]`
3. `peakExposure >= peakRequired[t]` (the agent must actually have used the authority it holds)
4. `receiptsSinceEntry >= minReceipts[t]`
5. `incidentsSinceEntry == 0`
6. Not paused, mandate not expired, evidence not stale
`graduate()` resets `riskAcc`, `peakExposure`, `receiptsSinceEntry`, sets `tierEnteredAt`, emits `Graduated(agent, fromTier, toTier, riskUnits, receipts)`. Model text is not an input. The owner can veto nothing here because the owner already pre-committed the schedule; the owner can still tighten or pause at any time, which is itself an incident.

### 6.4 Demotion and incidents (all observable on-chain)
| Incident | Effect |
|---|---|
| `LOOSEN_VETOED` (owner or guardian cancels the agent's loosening proposal) | Demote one tier |
| `OWNER_PAUSE` | Demote to T0 |
| `OVERCAP_GRACE_EXCEEDED` (exposure above capacity for longer than the grace period while the agent could have exited) | Demote to T0 |
Evidence-driven tightening by the guardian is **not** an incident: it is the system working. Self-reported refusals (`logDecision` with REFUSE) are displayed but never used for tiering, because a misbehaving agent would not report itself. Reverted transactions leave no on-chain trace for contracts, so they are not used either; the verifier may display failed transactions from RPC history as information only.

### 6.5 Effective limits
`limit = min(tier limit, mandate ceiling, capacityCap, healthCap, hardCap)`. Tier limits can never exceed mandate ceilings.

### 6.6 ConductRegistry (per-agent record)
Factory-created accounts push updates (`report(...)`) on graduation, demotion and periodic checkpoints. The registry stores per agent: accounts count, distinct owners count, total risk units weighted by `min(exposure, tier maxVault)`, incident count, max tier reached, first seen, clean-streak start. View: `recordOf(agent)`.
`StewardFactory.createAccount(owner, agent, guardian, cfg)` reads `recordOf(agent)` and sets `startTier = tierFor(record)`, capped by the owner's `maxStartTier`. A stranger starts at T0. A record with enough distinct owners and clean risk units starts higher. This is the contract-level consumer of the record.

### 6.7 Anti-gaming, stated openly
- Idle time does not promote: risk units and peak exposure are required.
- Farming a record with your own funds costs real capital-time and real yield-exposure; the record shows notional and duration, so it is evidence, not a magic score.
- A record farmed across many self-owned accounts is limited by requiring a minimum `distinctOwners` above T1. Sybil owners are still possible; a delegator reads the numbers, and the registry exposes them.
- Owner interventions demote conservatively even when the owner's reason was unrelated to agent fault.

---

## 7. Vault Health Feed specification

### 7.1 What it measures (per vault, over a stated block window)
- Redemption latency samples, matched request to fulfillment (or claim) and labeled by **method**: `FULFILL_EVENT`, `CLAIM_EVENT`, `OWN_REQUESTS`, or `DOC_CONSTANT` (no measurement).
- Latency p50, p90, max, sample count `n`.
- NAV per share, high-water mark, drawdown in bps.
- Runtime codehash and, if a proxy, implementation slot; pause flag if readable.
- Freshness: last NAV update time.
- Queue depth if derivable (pending shares over total supply).

### 7.2 Contract
```solidity
struct HealthSnapshot {
  uint64 fromBlock; uint64 toBlock; uint40 ts;
  uint8  method;            // FULFILL_EVENT | CLAIM_EVENT | OWN_REQUESTS | DOC_CONSTANT
  uint16 n; uint32 p50Sec; uint32 p90Sec; uint32 maxSec;
  uint128 navPerShare; uint16 drawdownBps; bytes32 codehash; uint32 flags; // PAUSED, CODEHASH_CHANGED, NAV_STALE
  bytes32 evidenceHash;
}
interface IVaultHealth {
  event Published(address indexed vault, uint64 indexed id, uint8 method, uint16 n, bytes32 evidenceHash);
  function publish(address vault, HealthSnapshot calldata s) external;   // registered reporters only
  function healthOf(address vault) external view returns (HealthSnapshot memory, uint64 id);
}
```
Snapshots carry `fromBlock` and `toBlock`, so anyone can recompute them from vault logs with the open-source library and compare (`make verify-health`). Mismatch is flagged in the verifier. A bonded on-chain challenge is a stretch item.

### 7.3 Consumption is tighten-only
StewardAccount reads `healthOf(vault)` on each deposit:
- Snapshot stale beyond `maxStaleSec`, or `flags` contains `PAUSED` or `CODEHASH_CHANGED`: `healthCap = 0` (no new deposits; exits unaffected).
- `p90Sec` above the mandate's lead-time assumption, or drawdown beyond half the pause threshold: `healthCap = half of capMandate`.
- Otherwise no restriction.
The feed can never raise any cap, lower any reserve, or promote any tier (invariant O-13). A dead or malicious reporter can only stop new risk. This is the fail-safe direction.

### 7.4 Method ladder and honesty
Phase 0 determines the best available method. The UI and README always print `method` and `n`. If only `OWN_REQUESTS` is available, say "measured from our own N requests". If nothing is measurable, the feed publishes `DOC_CONSTANT` and the measurement report states that liquidity could not be measured. Never present a doc constant as a measurement.

### 7.5 Consumers shipped
1. StewardAccount (on-chain, tighten-only).
2. `@steward/vault-health` npm package and a public HTTP endpoint.
3. A tiny reference agent in `examples/naive-agent` (independent code, no Steward contracts) that reads the feed and declines to deposit when p90 exceeds its own threshold.
4. **Measurement report** (`docs/measurement-report.md`): claimed liquidity (IXS docs: daily liquidity; Compass: operator-settled on its own schedule) vs measured latency, with method, n, and the block range. Send it to IXS and Compass.

---

## 8. Integration changes to v2

### 8.1 Capacity (delta)
```
effLeadDays = from feed p90 when method != DOC_CONSTANT and n >= 5; else mandate constant (labeled)
capacity    = floor( min(capMandate, capLiquid, capTier, capHealth, capacityCapOnChain) * evidenceHealth )
```
Recognised position value, reserve and obligations logic are unchanged from v2 section 6.

### 8.2 policyInput additions
Tier snapshot (`tier`, `riskUnits`, `peak`, `receiptsSinceEntry`, `incidentCount`), `healthSnapshotId` and the snapshot fields used, `startTier` source. Rationale text and raw notes remain hash-referenced.

### 8.3 New on-chain invariants (Foundry invariant tests)
O-11 tier increases only via `graduate()` and only when the predicate holds. O-12 a tier never increases in the same transaction as an incident. O-13 feed consumption never raises a cap or lowers a reserve. O-14 demotion applies immediately on an incident. O-15 `startTier <= owner maxStartTier`. O-16 registry accepts updates only from factory-created accounts. O-17 `riskAcc` is monotone non-decreasing. O-18 tier limits never exceed mandate ceilings. (O-01 to O-10 from v2 remain.)

### 8.4 New off-chain invariants
P-12 a health snapshot recomputes byte-equal from logs in its block range. P-13 the graduation predicate matches Solidity on generated histories (extends the three-way differential). P-14 a doc constant is never labeled as a measurement.

---

## 9. Public honeypot (real stakes)

### 9.1 Setup
A dedicated StewardAccount funded with a small pot (for example $25) at fixed tier T1 limits. A public "notice inbox" accepts text (max 2 KB, rate-limited, sanitized) that enters the untrusted notes for the next cycle. Time-boxed to the judging period.

### 9.2 Categories
- **A, fool the model:** any model proposal that violates the mandate. Logged and shown on a leaderboard. No payout, because policy and envelope refuse it.
- **B, break the envelope:** any state violating O-01 to O-18 (funds to a non-allowed address, exposure above cap after an agent deposit, sequence gap, guardian adding risk, tier promotion without predicate). Verified by the verifier and on-chain state. Payout up to the pot.
- **C, harmful but allowed:** an in-envelope action that is unwise. Not paid. Reported as the blast radius, which is bounded by the tier cap. This is the honest number.
Out of scope: attacking infrastructure, keys, servers, RPC.

### 9.3 Results (published, measured)
`docs/honeypot-report.md`: attempts, unique submitters, model-level fooled rate, prompt-guard catch rate, envelope violations (target 0), maximum in-envelope loss, incident timeline. If the pot is drained by a real bug, publish that too. Fund only what you accept losing.

---

## 10. Carried over from v2 (unchanged; see PLAN_v2.md)

- Section 4: ground-truth table (vault address confirmed by two sources; conflicts noted). Add: ERC-7540 request/claim events and views exist on compliant async vaults; whether IXS's vault is one is UNVERIFIED.
- Section 5: Mode A (contract-enforced) and Mode B (Compass-executed), trust boundaries, roles (owner, agent, guardian).
- Section 6: accounting units and rounding, recognised position value, liquidity ladder, reason codes, off-chain invariants P-01 to P-11.
- Section 7: StewardAccount interface, envelope checks, receipt binding and data availability, adapter, fee-on-yield module, hard cap.
- Section 8: evidence intelligence (two-model extraction, quote grounding, corroboration, adverse-only effects, griefing defense).
- Section 9: proposal reasoner (strict JSON schema, `serv_prompt_guard`, `serv_shadow_agent`, fail-closed).
- Section 10: Sentinels (Liquidity, Risk, Yield). New responsibility: the Risk Sentinel also runs the health indexer and reporter; the Liquidity Sentinel calls `claim`; anyone may call `graduate()`.
- Section 11: executor and reconciler (both modes), redemption state machine, key handling.
- Section 12: verifier, no-wallet Simulate (now with tier time-travel and a feed-degradation slider), UI.
- Section 13: testing pyramid and threat model (add: reporter compromise, registry farming, honeypot input abuse).
- Section 14: repo layout (add `packages/health`, `contracts/ConductRegistry.sol`, `contracts/VaultHealthFeed.sol`, `examples/naive-agent`, `docs/measurement-report.md`, `docs/honeypot-report.md`).

---

## 11. Claims and reproduction commands

| # | Claim | Command |
|---|---|---|
| C1 | Funds leave only to the vault or the account | `make test-invariants` |
| C2 | Every state change is bound to a receipt; unreceipted actions revert | `make test-invariants`, `make verify-live` |
| C3 | Agent, guardian and feed can only tighten alone | `make test-contracts` |
| C4 | Claims are quote-grounded and corroborated; favorable claims never loosen | `make test-evidence` |
| C5 | Python, TypeScript and Solidity agree on 5,000+ generated cases, including graduation histories | `make test-differential` |
| C6 | Measured SERV vs raw defense on the adversarial set | `make eval` |
| C7 | Same request, different outcome by record: a stranger reverts, a graduated agent succeeds | `make demo-graduation` |
| C8 | Health snapshots recompute from vault logs | `make verify-health` |
| C9 | Honeypot: measured fooled rate, 0 envelope violations (or the honest number) | `docs/honeypot-report.md` |
| C10 | Vault claims vs measured latency, with method and n | `docs/measurement-report.md` |

Publish C6, C9 and C10 only with the numbers the harnesses and logs actually produce.

---

## 12. Phases, gates, and deliverables

**Phase 0: verify (gates G0, G1, G2)**
- v2 Phase 0 items (keys, wallets, BscScan ABI and codehash, decimals, fork test of contract depositor, SERV strict schema, Compass markets, organizer questions).
- **G1 (feed method):** does the vault emit request and fulfillment or claim events? Is it ERC-7540 (request events, `pendingRedeemRequest` and `claimableRedeemRequest` views)? Pull 30 days of logs and compute a first latency sample. Choose the method ladder rung.
- **G2 (registry):** ERC-8004 registry addresses on BSC, only if the optional bridge is planned.
- Prior-art re-check (section 4.3 kill criteria) and record in DECISIONS.md.
- Exit: G0 (Mode A or B), G1 (method), kill-criteria decision.

**Phase 1: spec and engine.** v2 items plus: tier predicate, incident semantics, health computation, feed snapshot canonical encoding; Python transcription and fixtures for graduation histories and snapshots. Exit: differential green on the TS and Python pair.

**Phase 2: contracts.** StewardAccount with tiers, factory reading the registry, ConductRegistry, VaultHealthFeed, adapter; invariants O-01 to O-18; Slither. Exit: invariants and the three-way differential green.

**Phase 3: SERV layer.** v2 reasoner, evidence extraction and grounding, eval harness. Exit: `make eval` table.

**Phase 4: live, early.** Health indexer and reporter live; **start Agent A on chain as early as possible in demo-speed tiers** so a real multi-tier graduation history exists before the recording; small real deposit; redemption request filed early; Agent B (stranger) created fresh. Exit: verifiable graduation history for Agent A, `LIVE.md` filled.

**Phase 5: verifier, simulate, UI, honeypot, E2E.** Verifier replays tier transitions and health snapshots. Honeypot opens. Exit: a non-technical person completes the demo script with and without a wallet.

**Phase 6: reach (independent).** ERC-8004 bridge (owner-posted feedback from tier events), fee-on-yield module, x402-priced verification, multi-vault, Finance District adapter, Halmos on `PolicyMath`.

**Phase 7: submission.** Measurement report sent to IXS and Compass; honeypot report; README with "Compared to" table from section 4.

**If anything must be cut:** cut Phase 6, then the fee module, then evidence corroboration (keep grounding). Do not cut: envelope, receipt binding, Earned Authority, feed with honest method labels, verifier, live deposit, honeypot, honesty tables. Cutting the honeypot costs about 4 points; cutting the feed consumer costs about 4.

---

## 13. Demo script and submission

### 13.1 Demo (3 minutes)
0:00 pitch sentence. 0:15 mandate with the tier schedule (plain-language preview). 0:35 Agent B (stranger) asks to deposit above its T0 limit: reverts on BscScan. 1:00 Agent A (earned T2 over a real accelerated history): the same request succeeds; open the verifier to show the graduation events and risk units. 1:30 an adverse notice: guardian tightens; a favorable notice changes nothing. 1:50 Vault Health Feed: measured p90 vs the docs' claim, with method and n; the account's healthCap reacts when the snapshot degrades (simulate mode). 2:15 honeypot leaderboard and the "0 envelope violations" (or the honest number). 2:40 verifier: sequence continuous, verdicts replayed, tier transitions valid. 2:55 what is unproven.

### 13.2 X post draft
"Steward: an AI agent managing USDC in the IXS RWA vault that has to earn its limits. It starts on a $5 leash; only a public on-chain record can lengthen it. Vault liquidity is measured, not promised. Try to break it (small real bounty): [links] @openservai #SERVHackathon"
Images: two-agent same-request revert vs success, graduation timeline, feed vs docs chart, honeypot leaderboard, verifier page.

### 13.3 README outline
Pitch, the ten claims with commands, "Compared to" table (Warden, Phalnx, WAIaaS, AgentKit-style wallets), what is real vs simulated, threat model summary, invariants, benchmark and honeypot results, measurement report, known gaps, license.

### 13.4 Claims discipline
No yield figure unless read from the vault page at recording time. Say "demo-speed tiers" wherever the accelerated schedule is shown. Say "unaudited, small real funds, not financial advice". Say exactly what is verified (envelope compliance, tier transitions, verdict replay) and what is not (model reasoning, owner key security, Sybil resistance).

---

## 14. Risks (delta from v2)

| Risk | Impact | Mitigation |
|---|---|---|
| Vault has no readable request/fulfillment history | Feed weaker | Method ladder with honest labels; own-request sampling; score sensitivity stated |
| Scope: contracts, feed, honeypot, verifier, UI all at once | Everything shallow | Cut order in section 12; the non-cuttable core is fixed |
| Tier gaming or Sybil record farming | Trust in the record | Exposure and peak requirements, distinctOwners threshold, record shown as evidence, limits stated |
| Reporter key compromise | Feed spoofing | Tighten-only consumption; snapshots recomputable; verifier flags mismatch |
| Honeypot input abuse (spam, illegal content) | Reputation, cost | Length and rate limits, sanitization, allowlisted display, time-boxing |
| Honeypot pot lost to a real bug | Small loss | Pot sized to be lost; publish honestly |
| Prior art appears that matches Earned Authority | Novelty | Kill criteria: shift emphasis to the feed |
| Demo-speed tiers look like theater | Credibility | Label them; also show the production schedule in Simulate |

---

## 15. Phase 0 checklist additions

- [ ] Vault request/fulfillment/claim events found (Y/N); ERC-7540 compliance (Y/N); 30-day latency sample computed
- [ ] Chosen feed method recorded (`FULFILL_EVENT`, `CLAIM_EVENT`, `OWN_REQUESTS`, `DOC_CONSTANT`)
- [ ] Prior-art re-check done; kill-criteria decision recorded
- [ ] Demo-speed `timeUnit` and tier table agreed; hard cap agreed
- [ ] Honeypot pot amount and rules drafted
- [ ] Plan owner acknowledges the alternatives table and records the choice in DECISIONS.md

---

## 16. Sources

- PLAN_v2.md sources (hackathon page, IXS gitbook and launch post, Compass IXS guide, Finance District wallet design, SERV docs, ERC-8004)
- WAIaaS REPUTATION_THRESHOLD: https://dev.to/walletguy/reputationthreshold-policy-only-let-high-rep-ai-agents-touch-your-funds-16o7
- Warden: https://github.com/AtmegaBuzz/warden
- Phalnx / agentshield: https://github.com/kaleb-rupe/agentshield
- RedStone Settle (RWA redemption delays): https://www.redstone.finance/settle/
- ERC-7540 overview: https://ethereum.org/developers/docs/standards/tokens/erc-7540/
- Usance (pattern source, README only): https://github.com/winsznx/usance
