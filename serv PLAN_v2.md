# STEWARD v2: a contract-enforced, receipt-bound AI treasury agent for the IXS vault

Supersedes PLAN.md. Event: OpenServ SERV Hackathon Edition 01, RWA Vaults track (IXS). Written Sunday Sept 20 2026.
Labels: VERIFIED (read in an official or partner source), UNVERIFIED (check in Phase 0 before relying on it).
Pattern source: Usance (winsznx/usance). I have read its README only, not its code. Everything said about Usance below comes from that README.

---

## 0. What changed from v1, and why it is stronger

| v1 weakness | v2 fix |
|---|---|
| Limits enforced by an off-chain signing service. A stolen executor key means no limits. | **StewardAccount**: a per-owner smart contract holds the USDC and vault shares. The agent supplies only a typed action and an amount, never calldata or addresses. The contract enforces a monotone safety envelope on-chain. |
| Missing receipts were detectable after the fact. | **Receipt binding**: every state-changing call must carry the next sequence number and a receipt hash or it reverts. The full policy input is emitted in the event log, so anyone can replay a verdict with no operator database. |
| The model only proposed an action. | **Evidence intelligence**: SERV multi-model extraction of claims from untrusted notices, quote-grounded by a deterministic check, corroborated across models. Adverse claims can tighten capacity on their own. Favorable claims can never loosen anything. |
| Flat "redemption lead days" guess. | **Liquidity ladder** and **recognised position value** (Usance's min-of-haircuts idea applied to a vault position), with redemption latency measured from chain history where the vault exposes it. |
| One agent key. | **Least privilege**: an `agent` key (deposit, redeem) and a `guardian` key (tighten, pause, redeem only). The guardian cannot add risk. |
| Revenue was a hypothesis. | **Fee-on-yield module**: an operator is paid only from realised gains, capped by the mandate, with no path to principal. |
| Tests: unit and property. | Adds Foundry invariant fuzzing, Slither, three-way differential testing on thousands of generated cases, Playwright end-to-end, and a published adversarial benchmark. |
| Judges needed a wallet to try it. | A no-wallet `/simulate` page plus the live deployment. |
| Claims were prose. | Every claim has a command that reproduces it. |

---

## 1. The six claims (each reproducible)

| # | Claim | Reproduce with |
|---|---|---|
| C1 | No sequence of agent or guardian calls can move funds anywhere except the IXS vault or back into the account. | `make test-invariants` |
| C2 | Every state change is bound to the next receipt sequence and a receipt hash. Unreceipted actions revert. | `make test-invariants`, `make verify-live` |
| C3 | The agent and guardian can tighten capacity immediately. Loosening is owner-only, or optimistic with a veto window. | `make test-contracts` |
| C4 | Model-derived claims must quote the source verbatim. Adverse claims can tighten capacity alone. Favorable claims never loosen. | `make test-evidence` |
| C5 | The Python spec transcription, the TypeScript engine, and the Solidity library agree byte-for-byte on at least 5,000 generated scenarios. | `make test-differential` |
| C6 | Measured, not asserted: unsafe-proposal and injection-success rates for raw model vs SERV vs SERV + policy on a published adversarial set. | `make eval` (needs `SERV_API_KEY`) |

Publish C6 only with the numbers the harness actually produces.

---

## 2. Versus Usance, and versus the typical entry

### 2.1 Head to head (honest)

| Area | Usance (per its README) | Steward v2 target |
|---|---|---|
| Core principle | AI interprets, deterministic code controls money | Same, plus the contract envelope holds even if the off-chain engine is compromised |
| Spec discipline | spec/ folder, invariants I-nn, frozen fixtures, DECISIONS.md | Same, adopted deliberately |
| Differential testing | Solidity, TypeScript, Python agree to the wei on 22 scenarios | Same three implementations on 5,000+ generated cases plus 30 canonical ones |
| Honesty section | "Verified live" and "Not available, and not faked" tables | Same, in README and `LIVE.md` |
| Evidence handling | Extraction with single-path Passports capped by policy | Two-model corroboration through SERV, deterministic quote grounding, adverse-only auto-action |
| Autonomy | Sentinels specified and interfaces frozen, not implemented | Three Sentinel roles implemented and running live |
| Deployment | No contracts deployed yet (no funded key) | Deployed and source-verified on BSC with a small hard-capped balance, public verifier URL |
| Testing | 17 contract + 36 TS tests, E2E listed as a gap | Invariant fuzzing, Slither, differential, Playwright E2E in CI |
| Verification by third parties | Reproducible from a fresh clone | Reproducible from a fresh clone and from chain data alone |
| Scope | Broader: collateral lending, cross-chain saga, Hedera institutional facility | Narrower and complete: one vault, live, verifiable |

Where Usance is broader, Steward is not trying to match it. The bet is that a smaller system that is deployed, autonomous and independently verifiable beats a larger one with declared gaps.

### 2.2 The typical entry in this track
Likely shape: an LLM picks a vault and calls an API, with a dashboard. Usually no enforcement outside the prompt, no verification, no adversarial testing, no evidence it ran on real funds. Steward is designed to be different on all four.

### 2.3 Alignment with IXS's own framing
IXS's launch post says the human sets the policy and the agent executes inside it. Steward is the piece that makes that sentence checkable.

---

## 3. Ceiling check v2

- **Deletion test:** remove the envelope and receipts and the agent's conduct becomes a trust-me claim. Remove the SERV layer and the system still enforces safety but loses evidence interpretation and the measured-defense story. The mechanism whose deletion makes something unverifiable is the envelope plus receipt binding, so that is what must be built first and best.
- **One-sentence pitch:** "The agent's authority is a smart contract, every action is a receipt anyone can replay, and the AI can only make the limits tighter on its own."
- **Outside the event:** real vault, real funds (small), real public verifier.
- **Stakes:** a stolen agent key or a prompt-injected model cannot drain the account. That is testable by anyone.
- **Weak points to state openly:** the model's reasoning is not verified, only verdicts and envelope compliance; the owner key is out of scope; the contract is unaudited, so the deployment is hard-capped; Mode A depends on unverified vault behavior (section 5.2).

---

## 4. Ground truth

| Fact | Source | Status |
|---|---|---|
| Vault address `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82` on BNB Chain | IXS's own launch post and the Compass guide (two independent sources) | VERIFIED by sources; confirm code, proxy status and decimals on-chain |
| IXS calls it the Agentic Vault; Compass calls it the Permissionless Vault | IXS post, Compass guide | Same address, two names |
| Underlying: SHYG-backed (Compass) vs institutional RWA yield "starting with FDUSD" (IXS) | Compass, IXS gitbook and post | CONFLICT: quote only what the vault page says at recording time |
| No protocol-layer KYC for permissionless vaults | IXS gitbook | VERIFIED (docs) |
| Deposits mint instantly; redemptions asynchronous, operator-settled, no instant sell | Compass guide | VERIFIED (docs) |
| Can an arbitrary contract deposit directly (not via a Compass Tokenized Assets Account)? | none | UNVERIFIED, the gate for Mode A |
| Vault ABI: ERC-4626 views (`convertToAssets`, `totalAssets`), async request/claim interface (ERC-7540-style?), events for request and finalize | none (BscScan source not retrieved) | UNVERIFIED |
| USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (Binance-Peg); decimals likely 18, not 6 | Compass guide; decimals is my belief | UNVERIFIED: read `decimals()` on-chain and pin it in the mandate |
| Compass API returns unsigned txs; pass its `gas` through (Safe error GS013 otherwise) | Compass guide | VERIFIED (docs) |
| Access described by IXS runs through the Finance District Agent Wallet (MCP, CLI); IXS APIs are x402-compatible | IXS post | VERIFIED (post) |
| SERV: OpenAI-format endpoint, system message required, strict JSON schema, `serv_prompt_guard`, `serv_shadow_agent` (`hint`, `max_iterations`), multi-model catalog | SERV docs | VERIFIED (docs); shadow-agent failure marker UNVERIFIED |
| ERC-8004 infrastructure announced on BSC mainnet and testnet | BNB Chain announcement coverage | Announced; registry addresses UNVERIFIED |
| Hackathon: eligibility needs data collection enabled; submission via public X post tagging @openservai plus a form | Hackathon FAQ | VERIFIED |

---

## 5. Architecture

### 5.1 Two-tier enforcement

```
        Owner ---sets mandate, raises limits---> StewardAccount (BSC)  <--- Guardian key: tighten, pause, redeem
                                                   |  holds USDC + vault shares
      untrusted text (notices, pages)              |  enforces envelope + receipt sequence
              |                                    ^
              v                                    | typed action + receipt (no calldata, no addresses)
   SERV extraction x2 models --> grounding check --> claims --+
              |                                               v
   chain + vault reads --> evidence snapshot -----> Policy engine (TS, pure, replayable)
                                  |                    ^  verdict + reasons + capacity breakdown
                                  v                    |
                       SERV Reasoner (proposal, untrusted) ---> Sentinels (Liquidity, Risk, Yield)
                                                                   |
                                                    Agent key --> StewardAccount.execute(...)
                                                                   |
                          Decision event (PolicyInput + verdict) ---> Verifier / Simulate / UI
```

- **Tier 1, on-chain envelope (hard, minimal, monotone):** allowlist, per-tx cap, exposure cap, reserve, rate limit, expiry, pause, hard deposit cap, receipt sequence.
- **Tier 2, off-chain engine (rich, replayable):** recognised value, liquidity ladder, evidence health, claims. Its only channel to the chain is tightening the envelope or requesting typed actions inside it.

### 5.2 Execution modes (decided at the Phase 0 gate)

| Mode | How | Enforcement | Depends on |
|---|---|---|---|
| A: contract-enforced (target) | StewardAccount calls the vault directly through an adapter | On-chain envelope | The vault accepting contract depositors and a known ABI |
| B: Compass-executed (fallback) | Compass returns unsigned txs, a burner signs | Off-chain engine only, plus a receipt log contract | Compass account creation working |

The verifier and UI always display which mode ran, with the enforcement level stated plainly. Both modes share the policy engine, evidence layer, Sentinels and receipts.

### 5.3 Trust boundaries
- Model can: read the evidence it is handed; emit a proposal `{action, amount}` and structured claims.
- Model cannot: name addresses, produce calldata, set limits, raise capacity, see keys, choose the policy version, or call any tool that touches funds.
- The agent key can: `deposit`, `requestRedeem`, `claim`, `logDecision`, `tightenCap`, `raiseReserve`, `pause`, `proposeLoosenCap`.
- The guardian key can: `tightenCap`, `raiseReserve`, `pause`, `requestRedeem`, `cancelLoosen`, `logDecision`.
- The owner can: everything above plus set the mandate, raise limits, unpause, `withdraw(to, amount)`, emergency redeem.

---

## 6. Accounting and policy specification (spec-first, like Usance)

Write `spec/accounting.md` before code. It freezes: units, rounding, formulas, reason codes, canonical encoding.

### 6.1 Units and rounding
- Internal unit: the token's smallest unit, integers only (`uint128`/`bigint`), never floats. Pin `decimals` in the mandate; refuse to run if on-chain `decimals()` differs.
- Rounding always reduces risk: capacity and recognised value round **down**; reserve and haircuts round **up**; fees round **down** (owner's favor); cost basis attributions round in the owner's favor.

### 6.2 Recognised position value (Usance's min-of-haircuts idea, applied to a vault position)

```
navMark        = shares * navPerShare
h_issuer       = mandate.issuerHaircutBps (+ step per adverse claim, section 8)
h_latency      = min(mandate.latencyHaircutMaxBps, mandate.latencyHaircutBpsPerDay * effLeadDays)
recognisedPos  = floor(navMark * (10000 - h_issuer) * (10000 - h_latency) / 1e8)
```
The agent never counts the position as cash. Only `recognisedPos` enters treasury value for capacity.

### 6.3 Liquidity ladder

```
effLeadDays = max(mandate.leadFloorDays, ceil(q90Latency * mandate.latencySafety))
              q90Latency from on-chain request/finalize events if n >= 5,
              else max(observed) * 2 if n >= 1, else mandate.leadFloorDays
reserve     = minLiquid + sum(obligations with due < now + effLeadDays + bufferDays)   (round up)
redeemBy(o) = o.due - effLeadDays - bufferDays
```
If the vault exposes no readable request/finalize history, `effLeadDays = leadFloorDays` and the UI labels the source as "mandate constant, not measured".

### 6.4 Capacity

```
treasury    = liquid + recognisedPos + finalizedNotYetClaimed + pendingRedemptionExpected (haircut)
capMandate  = min(maxBps * treasury / 10000, maxVaultUsdc)
capLiquid   = max(0, treasury - reserve)
health      = 0    if stale evidence, codehash mismatch, paused, drawdown >= pause threshold,
                      or any corroborated severe adverse claim
              0.5  if single-path adverse claim, observed latency > effLeadDays, or half-threshold drawdown
              1    otherwise
capacity    = floor(min(capMandate, capLiquid, capacityCapOnChain) * health)
headroom    = max(0, capacity - exposure);  overCap = max(0, exposure - capacity)
```
The binding term is recorded in every receipt and shown in the UI.

### 6.5 Verdicts and reason codes
Verdicts: `ALLOW`, `ALLOW_CLAMPED` (mandate flag), `NEEDS_APPROVAL`, `REFUSE`.
Reason bitmask: `OK, HOLD_NOOP, MANDATE_INVALID, MANDATE_EXPIRED, AGENT_MISMATCH, TARGET_NOT_ALLOWED, OVER_CAPACITY, OVER_MAX_TX, BELOW_RESERVE, STALE_EVIDENCE, CODEHASH_CHANGED, DRAWDOWN_PAUSE, ADVERSE_CLAIM, UNGROUNDED_CLAIM, RATE_LIMIT, ABOVE_APPROVAL_THRESHOLD, HARD_CAP, PROPOSAL_INVALID, MODEL_FAILED_OUTPUT, OWNER_PAUSED, MANDATORY_DERISK`.

### 6.6 Rules (asymmetric authority)
- `DEPOSIT(x)`: needs `x <= headroom`, `x <= maxTx`, `liquid - x >= reserve + minLiquid`, rate limit, fresh evidence, deposit hard cap. Above `approvalAbove`, `NEEDS_APPROVAL`.
- `REQUEST_REDEEM(x)`: risk-reducing, allowed up to the position, subject only to the rate limit. Allowed even when paused or expired.
- `HOLD`: always allowed and always logged.
- `overCap > 0` triggers `MANDATORY_DERISK`. If the model does not propose the exit, the Risk Sentinel proposes it deterministically.
- Increasing exposure is judged only on mandate plus deterministic evidence, never on model rationale text or on an uncorroborated favorable claim.

### 6.7 Off-chain invariants (each is a test)
P-01 target and token are in the allowlist. P-02 post-deposit liquid at least reserve + minLiquid. P-03 post-deposit exposure at most capacity. P-04 no numeric limit is read from model output. P-05 `REQUEST_REDEEM` never increases exposure. P-06 invalid or expired mandate allows only exit or hold. P-07 stale evidence gives capacity 0. P-08 identical `(mandate, evidence, claims, proposal, policyVersion)` gives a byte-identical verdict in all three implementations. P-09 favorable claims never increase capacity. P-10 a claim without a verbatim source quote is dropped. P-11 rounding never favors risk.

### 6.8 On-chain invariants (Foundry invariant tests)
O-01 assets leave the account only to the vault or, via owner `withdraw`, to an address the owner chose. O-02 after any agent `deposit`, exposure at most `min(maxBps*value, maxVault, capacityCap)`. O-03 after any agent `deposit`, USDC balance at least reserve + minLiquid. O-04 agent and guardian cannot raise `capacityCap` or lower `reserve` immediately. O-05 guardian can never increase exposure. O-06 sequence is strictly +1 per state-changing call, and gaps are impossible. O-07 while paused only `requestRedeem` and `claim` succeed. O-08 total deposited never exceeds `hardCap`. O-09 operator fees never exceed `feeBps * realised gain` and never touch principal. O-10 no reentrancy path changes accounting.

---

## 7. On-chain design: StewardAccount

Non-upgradeable, minimal, one instance per owner from a `StewardFactory`. Immutable constructor args: owner, agent, guardian, usdc, vault, adapter, hard deposit cap.

### 7.1 Interface sketch

```solidity
struct Mandate {
  uint128 maxTxUsdc; uint16 maxBps; uint128 maxVaultUsdc; uint128 minLiquidUsdc;
  uint32  maxActionsPerDay; uint40 expiry; uint32 loosenDelay;
  uint16  feeBps; uint16 maxFeeBps; address operator;
}
struct Envelope { uint128 capacityCap; uint128 capCeiling; uint128 reserveUsdc; bool paused; }

event Decision(address indexed actor, uint64 indexed seq, bytes32 indexed receiptHash,
               uint8 action, uint128 amount, uint8 verdict, uint32 reasonMask, bytes policyInput);

// agent
function deposit(uint128 assets, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;
function requestRedeem(uint128 shares, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external; // agent or guardian
function claim(uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;                          // agent or owner
function logDecision(uint64 seq, bytes32 receiptHash, uint8 verdict, uint32 reasons, bytes calldata policyInput) external;    // agent or guardian
// tightening (agent, guardian, owner): immediate
function tightenCap(uint128 newCap, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;
function raiseReserve(uint128 newReserve, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;
function pause(uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;
// loosening: agent proposes, owner or guardian may veto, applies after loosenDelay, never above capCeiling
function proposeLoosenCap(uint128 newCap, uint64 seq, bytes32 receiptHash, uint32 reasons, bytes calldata policyInput) external;
function cancelLoosen() external;      // owner or guardian
function applyLoosen() external;       // anyone, after delay
// owner only
function setMandate(Mandate calldata m) external;
function setCapCeiling(uint128 c) external;  function setCap(uint128 c) external;  function setReserve(uint128 r) external;
function unpause() external;  function withdraw(address to, uint128 amount) external;  function emergencyRedeem() external;
```

### 7.2 What `deposit` checks (all on-chain, using on-chain balances)
not paused; `block.timestamp <= expiry`; `assets <= maxTxUsdc`; daily action count; `seq == nextSeq`; `totalDeposited + assets <= hardCap`; `usdc.balanceOf(this) - assets >= reserve + minLiquid`; `exposureAfter <= min(maxBps * totalValue / 10000, maxVaultUsdc, capacityCap)` where exposure counts pending redemptions as exposed until claimed. The contract builds the vault call itself through the adapter. The agent never supplies calldata or a target.

### 7.3 Asymmetric authority, on-chain
Tightening is immediate and open to agent, guardian and owner. Loosening is owner-immediate, or agent-proposed with a veto window (`loosenDelay`, short for the demo, longer in production) and capped by an owner-set `capCeiling`. This is Usance's "an AI-only reading cannot raise your risk" implemented as contract logic.

### 7.4 Receipt binding and data availability
Every state-changing function requires `seq == nextSeq` and emits `Decision` with the full `policyInput` bytes (mandate snapshot hash, numeric evidence, extracted claims with quotes, and the proposal action and amount). Rationale text and raw notes are referenced by hash only. BSC gas is low, so a few kilobytes per decision is affordable, and the verifier needs no operator database. The contract cannot check that `receiptHash` matches the content, so the verifier does: a mismatch is flagged "unverifiable receipt".

### 7.5 Adapter (unknown until Phase 0)
`IVaultAdapter` isolates vault specifics: `deposit(assets)`, `requestRedeem(shares)`, `claim()`, `navPerShare()`, `sharesOf(account)`, `pendingAssets(account)`, `codehash()`. Ship the adapter matching the real ABI; write it against a BSC fork test first. If the ABI is non-standard or depositors are restricted, fall back to Mode B.

### 7.6 Fee-on-yield module (Phase 6, spec now)
- Track `costBasis` and `shares`. On deposit: `basis += assets`. On redeem request of `s` shares: `basisOut = floor(basis * s / shares)`, decrement both, rounded in the owner's favor.
- On `claim` with `received` assets: `gain = max(0, received - basisOut)`, `fee = floor(gain * feeBps / 10000)`, accrued to `operator`, never above `maxFeeBps`.
- The operator can only `claimFees()` for accrued amounts. There is no path to principal (O-09).

### 7.7 Hard limits for an unaudited demo
Constructor-level `hardCap` (for example 100 USDC), a documented "unaudited, experimental" banner, Slither clean, invariant suite green, and only a burner-sized balance. `LIVE.md` states all of this.

---

## 8. Evidence intelligence (SERV as the interpretation layer)

Usance reads issuer evidence and extracts structured claims. Steward does the same for vault and issuer notices, with stronger gating.

### 8.1 Sources
Allowlisted URLs only (IXS vault page and announcements, IXS gitbook pages, Compass changelog or status, the issuer fact sheet if a stable URL exists). Owner-pasted text is accepted but marked lower trust. Each fetched text is stored and hashed.

### 8.2 Pipeline
1. Fetch, normalize whitespace, hash.
2. Call SERV twice with **different models** (for example `gpt-5.4-mini` and `claude-haiku-4.5`, or a Gemini Flash variant) using a strict JSON schema: `claims[] { type, polarity, quote, severity }`, with `type` an enum (`REDEMPTION_GATING, REDEMPTION_DELAY, UNDERLYING_CHANGE, NAV_METHOD_CHANGE, YIELD_CHANGE, CUSTODY_CHANGE, PAUSE, REGULATORY, OTHER`). Add `serv_prompt_guard` and `serv_shadow_agent` with the hint "every claim must include a verbatim quote from the source text".
3. **Deterministic grounding:** each claim's `quote` must appear verbatim in the source after whitespace normalization. Ungrounded claims are dropped and counted (`UNGROUNDED_CLAIM`).
4. **Corroboration:** a claim is CORROBORATED if both models produce the same `(type, polarity)` with grounded quotes overlapping the same source region. Otherwise SINGLE.
5. **Effect table:**

| Claim | Effect |
|---|---|
| ADVERSE, severe type, CORROBORATED | Capacity 0, `pause` new risk, `MANDATORY_DERISK` |
| ADVERSE, SINGLE | Health 0.5, issuer haircut step, no forced exit |
| FAVORABLE, any | Recorded only. Never raises capacity or headroom |
| NEUTRAL | Recorded only |

6. Recovery: capacity may return only through the owner or through `proposeLoosenCap` after a quiet window with no adverse claims and healthy on-chain metrics, subject to the veto window.

### 8.3 Griefing defense
An attacker who plants adverse-looking text must not be able to force endless exits. Countermeasures: allowlisted sources only; forced exit needs corroboration and a severe type; rate limits on auto-tightening; every adverse action logged with its quote so the owner can see and override it.

### 8.4 Why two models
SERV exposes several providers through one endpoint. Corroboration across providers is cheap there and is a concrete reason the reasoning layer matters. Measure single-path vs corroborated false-positive rates in `make eval`.

---

## 9. Proposal reasoner (SERV)

- OpenAI SDK against `https://inference-api.openserv.ai/v1`, default `gpt-5.4-mini`; benchmark against `claude-haiku-4.5` and `claude-sonnet-5`.
- Strict JSON schema: `{ action: DEPOSIT|REDEEM|HOLD, amount: decimal string, rationale (max 600 chars), inputs_used: enum[], confidence, next_review_hours }`. No address, calldata, vault or limit fields.
- Tools array: `serv_prompt_guard` always; `serv_shadow_agent` with `default` values for `hint` and `max_iterations` (suggested hint: cite only numbers present in the input, plain decimal amounts, state the liquidity horizon used).
- Fail closed: schema violation, failed shadow output, timeout, refusal or empty content becomes `HOLD` with `MODEL_FAILED_OUTPUT`.
- Prompt: role, hard facts about async redemption, priorities (never leave obligations unfunded, respect the capacity summary, prefer HOLD when unsure), untrusted-text rule, JSON only. Test SERV's Multipath feature for the branching logic and Kronos for prompt auditing; adopt only if measured better.
- Cost (estimates): about $0.007 per plain call, about $0.02 to $0.03 with shadow iterations, on the small model. The $5 credit covers a few hundred cycles; the eval harness needs roughly $1 to $3 including dual-model extraction.

---

## 10. Sentinels (implemented, not just specified)

Loop for each: **Observe, Plan, Ask, Decide (policy), Act.**

| Sentinel | Key | Allowed actions | Job |
|---|---|---|---|
| Liquidity | agent | `requestRedeem`, `claim`, `raiseReserve`, `logDecision` | Schedule redemptions by `redeemBy`, claim finalized redemptions, keep the reserve funded |
| Risk | guardian | `tightenCap`, `pause`, `requestRedeem`, `cancelLoosen`, `logDecision` | Run evidence intelligence, tighten on adverse claims and drawdown, force exit when `overCap` |
| Yield | agent | `deposit`, `proposeLoosenCap`, `logDecision` | The only risk-increasing role: deposits idle cash inside headroom, above the approval threshold it asks the owner |

Least privilege is real: the guardian key cannot call `deposit`, and the Yield role cannot lower the reserve.

---

## 11. Executor and reconciler

### Mode A
Build the typed call, simulate on the fork or with `eth_call`, send from the agent or guardian key, wait, then reconcile against the emitted `Decision` and vault logs. Idempotency key is `receiptHash`; one in-flight action per account; nonce management; circuit breaker after 3 consecutive failures; local kill flag; dry-run by default.

### Mode B
`create_account`, `transact/buy`, `transact/sell`, `redemptions` polling, `transfer` with `action: WITHDRAW`, passing the API `gas` through. Decode returned calldata and refuse if `to` or token is outside the allowlist. Receipts go to a lightweight `ConductLog` contract; the account remains off-chain enforced, and the UI says so.

### Redemption state machine
`REQUESTED, PENDING, FINALIZED, CLAIMED, WITHDRAWN` plus `STUCK` (pending beyond `effLeadDays`, which lowers health) and `FAILED`.

### Keys
Burner agent and guardian keys, encrypted keystore, passphrase from env, secret scan in CI, never in the repo. Owner uses a separate wallet.

---

## 12. Verifier, Simulate, and UI

### 12.1 Public verifier (no login)
Input: a StewardAccount address. It reads `Decision` and mandate events, rebuilds mandate and envelope state at each `seq`, decodes each `policyInput`, runs the same TypeScript engine in the browser, and compares the verdict and reasons with the logged values. It checks sequence continuity, ERC-20 transfer logs (funds moved only to the vault or the owner), vault call effects in the same transaction, and that every receipt hash matches published content. Output: decisions, allow/refuse ratio, near-misses (within 5% of a cap), refusals by reason, current capacity and binding term, mode and enforcement level. It states its own limit: verdicts are verified, model reasoning is not.

### 12.2 No-wallet Simulate
Frozen canonical scenarios run live in the browser through the TypeScript engine and a TypeScript port of the on-chain envelope. Controls: mandate sliders, an "evidence health" slider that moves capacity in real time, and the attack lab. Judges can use this without a wallet or funds.

### 12.3 Live app
Mandate builder (plain-language preview, sign, set on-chain), dashboard (liquid, recognised position, capacity gauge with the binding term, obligations timeline, redemption tracker), decision feed (evidence, proposal, verdict, reasons, tx, SERV latency and cost and shadow outcome), approvals inbox, attack lab, controls (pause, veto, emergency exit).
Design rule: the browser never invents a financial number. Every figure comes from the policy package or a chain read.

---

## 13. Testing, CI, and threat model

### 13.1 Pyramid
1. Unit tests for every rule and reason code (vitest, Foundry).
2. Property tests (fast-check) for P-01 to P-11.
3. **Foundry stateful invariant tests** for O-01 to O-10 with an agent, guardian and owner handler, at least 10k runs per invariant in CI. Optional Halmos check on `PolicyMath`.
4. **Three-way differential:** `scripts/gen_fixtures.py` transcribes the spec and generates at least 5,000 random scenarios plus 30 canonical ones; TypeScript and Solidity must match byte-for-byte. CI regenerates fixtures and fails on drift.
5. **BSC fork tests:** deposit, request, claim against the real vault at a pinned block.
6. **Evidence tests:** quote grounding, corroboration table, favorable-never-loosens, griefing rate limits.
7. **Eval harness** (`make eval`): 100 scenarios including the adversarial set; raw model vs SERV vs SERV + policy; report schema-valid rate, unsafe-proposal rate, injection success, single-path vs corroborated claim precision, cost, latency. Publish the dataset.
8. **Playwright E2E:** onboard, sign, cycle, approve, attack, verify.
9. **Chaos:** RPC lag, duplicate cycle trigger, crash between sign and broadcast, malformed vault notes.
10. Slither and a secrets scan on every push.

### 13.2 Adversarial set
Instruction override in notes; fake "mandate updated" text; prompt extraction; unit and decimals confusion (6 vs 18); lookalike vault address; fabricated obligation; oversized input to displace facts; JSON or markdown breakout; stale evidence dressed as fresh; "disable safety for a test"; a fake adverse notice to trigger griefing; a favorable notice claiming "cap can be raised".

### 13.3 Threat model

| Attacker | Capability | Defense | Residual risk |
|---|---|---|---|
| Prompt injector | Controls notice text | Prompt guard, schema, grounding, policy, envelope | Model may be fooled; the envelope still holds |
| Stolen agent key | Calls agent functions | Typed actions, envelope, hard cap, guardian veto, pause | Can act inside the envelope, bounded by caps |
| Stolen guardian key | Tighten, pause, redeem | Cannot add risk | Griefing by pausing; owner unpauses |
| Malicious API response (Mode B) | Wrong calldata | Decode and allowlist check, simulation | Off-chain enforcement only |
| Vault upgrade or pause | Silent behavior change | Codehash pin, capacity 0 on change, guardian tighten | Time between change and detection |
| Griefing via fake adverse text | Forces exits | Allowlisted sources, corroboration for forced exit, rate limits | Some unnecessary tightening |
| Receipt forgery or withholding | Fake or missing content | Sequence binding, hash check, data in event logs | Unverifiable receipts are flagged, not prevented |
| Owner key theft | Full control | Out of scope | Stated openly |
| Contract bug | Fund loss | Invariants, Slither, fork tests, hard cap, tiny balance | Unaudited; stated openly |

---

## 14. Repo layout and commands

```
steward/
  spec/                accounting.md, invariants.md, threat-model.md, DECISIONS.md
  fixtures/            canonical + generated scenarios (frozen)
  packages/policy      TS engine, mandate types, reason codes
  packages/evidence    extraction schemas, grounding, corroboration
  packages/serv        SERV client, prompts, eval harness
  packages/receipts    canonical encoding, hashing, verifier core (shared with web)
  packages/compass     Mode B client and calldata guard
  contracts/           StewardAccount, StewardFactory, PolicyMath, adapters, ConductLog, Foundry tests
  services/steward     Sentinels, executor, reconciler
  scripts/             gen_fixtures.py, verify_live.ts, seed and demo tools
  apps/web             app, /simulate, /verify, attack lab
  e2e/                 Playwright
  docs/                LIVE.md, README material, benchmark write-up
```

Commands: `make doctor`, `make bootstrap`, `make test` (offline), `make test-contracts`, `make test-invariants`, `make test-differential`, `make test-evidence`, `make fork-test` (needs BSC RPC), `make eval` (needs SERV key), `make demo-local` (no wallet, opens /simulate), `make deploy-bsc-testnet`, `make deploy-bsc`, `make verify-live`.
Run Foundry inside WSL on Windows.
Stack: TypeScript, pnpm workspaces, viem, zod, vitest, fast-check, Next.js, SQLite (for the service, not for verification), Foundry, Python 3 for the spec transcription, Playwright.

`LIVE.md` (Usance-style honesty file): deployed addresses, tx hashes, block numbers, what is real, what is simulated, what failed and why, current caps and balances.

---

## 15. Phases and gates

**Phase 0: verify (gate G0 decides Mode A or B)**
- Enable data collection in the SERV console; create SERV and Compass keys; create burner agent, guardian and owner wallets.
- BscScan: vault code, proxy slots, ABI, events, `decimals()`, USDC details.
- Fork test on BSC: can a fresh contract call the vault `deposit`? Is there a request/claim path? Are request and finalize events readable for latency history?
- First SERV call with strict schema, shadow agent, prompt guard; inspect how a failed shadow output appears.
- Compass `markets?provider=ixs&chain=bsc`; Mode B account creation.
- Ask organizers: mainnet requirement, Compass counts as "with IXS", any IXS test environment, real redemption window.
- Exit: G0 = Mode A if a contract depositor works and the ABI is usable; otherwise Mode B with the receipt log. If neither Compass nor direct deposit works, switch to the AgentKit track.

**Phase 1: spec and engine.** `spec/`, Python transcription, TypeScript engine, canonical fixtures, P-01 to P-11. Exit: `make test-differential` green on the TS and Python pair.

**Phase 2: contracts.** StewardAccount, factory, PolicyMath, adapter, invariants O-01 to O-10, Slither clean, fork tests. Exit: `make test-invariants` and the three-way differential green.

**Phase 3: SERV layer.** Reasoner, evidence intelligence, grounding, corroboration, eval harness with first numbers. Exit: `make eval` produces the results table.

**Phase 4: Sentinels and live.** Executor, reconciler, three Sentinels, small real deposit, redemption request filed early (async), receipts on-chain. Exit: a live run verifiable end to end; `LIVE.md` filled.

**Phase 5: verifier, simulate, UI, E2E.** Exit: a non-technical person completes the demo script unaided, with and without a wallet.

**Phase 6: reach (independent items).** Fee-on-yield module; ERC-8004 identity for the agent on BSC with owner-posted feedback (self-posted reputation is weak, and the Validation registry is still under revision); Halmos on `PolicyMath`; multi-vault; operator mode (several owners); Finance District Agent Wallet adapter as the IXS-native executor; x402-priced verification endpoint; loosen-delay tuning.

**Phase 7: submission.** Package in section 16.

**If anything must be cut, cut in this order:** Phase 6 items, then Mode A extras (fee module, loosening veto window), then evidence corroboration (keep grounding), then E2E breadth. Do not cut: the envelope, receipt binding, the verifier, the live deposit, the honesty tables.

---

## 16. Submission package

### 16.1 Pitch (three things anyone can check)
1. The agent's authority is a smart contract, not a prompt.
2. Every action is a receipt anyone can replay from chain data.
3. The AI can only make the limits tighter on its own.

### 16.2 Demo video (3 minutes)
0:00 problem in one sentence. 0:15 sign a mandate (plain-language preview). 0:35 live deposit through the contract, receipt and event on BscScan. 1:05 obligation added: the Liquidity Sentinel schedules a redemption because settlement is asynchronous. 1:30 attack lab: injection blocked, and a deliberately fooled model still cannot exceed the envelope (show the revert). 2:00 adverse notice: Risk Sentinel tightens capacity; a favorable notice changes nothing. 2:25 verifier page: sequence continuous, verdicts replayed green. 2:45 results: benchmark table, cost per decision, what is unproven.

### 16.3 X post draft (name, concept, images, links, tag @openservai)
"Steward: an AI agent that manages USDC in the IXS RWA vault, but its authority is a smart contract. Every action is a receipt anyone can replay, and the AI can only tighten limits on its own. Live on BNB Chain, small funds, unaudited. Try it with no wallet: [simulate link]. Repo, verifier and benchmark: [links] @openservai #SERVHackathon"
Images: architecture diagram, mandate screen, decision feed, verifier page, the reverted attack transaction.

### 16.4 README outline
Pitch, three checks, the six claims with commands, what is real vs simulated, head-to-head with the typical approach, architecture, threat model summary, invariants, benchmark results, known gaps, license.

### 16.5 Claims discipline
No yield figure unless read from the vault page at recording time. No description of the vault's underlying assets beyond the vault page. Say "small real funds, experimental, unaudited, not financial advice". Say exactly what is verified (verdicts, sequence, envelope compliance) and what is not (model reasoning, owner key security).

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Vault rejects contract depositors or has an unusable ABI | Mode A impossible | G0 fork test on day one; Mode B fallback with honest labeling |
| Scope too wide, everything shallow | Weaker than a smaller polished entry | Priority order in section 15; the non-cuttable core is the envelope, receipts, verifier, live deposit |
| Contract bug with real funds | Loss | Hard cap, tiny balance, invariants, Slither, fork tests, unaudited banner |
| Event data too large or gas surprises on BSC | Cost or reverts | Measure in Phase 2; hash fallback for large fields |
| Redemption events not readable | Ladder falls back to a constant | UI labels source as "mandate constant" |
| Dual-model extraction disagrees constantly | Noise | Tune schema, measure precision, use enums and quotes |
| Shadow agent latency and cost | Slow demo | Small models, low `max_iterations`, cache evidence, show cost |
| "Via Compass" or direct deposit questioned as not "with IXS" | Eligibility doubt | Ask organizers; Finance District adapter in Phase 6 |
| Claims outrun evidence | Credibility loss | Section 16.5; publish only measured numbers |

---

## 18. Phase 0 checklist (copy into an issue)

- [ ] Data collection enabled in the SERV console
- [ ] Keys: SERV, Compass; wallets: owner, agent, guardian (burners, small balances)
- [ ] Vault on BscScan: proxy or not, implementation slot, codehash, ABI, events
- [ ] USDC `decimals()` read on-chain and pinned
- [ ] Fork test: fresh contract deposits into the vault (Y/N)
- [ ] Request and claim path identified; finalize events readable (Y/N)
- [ ] SERV strict-schema call works; shadow-agent failure marker identified
- [ ] Compass `markets` returns the vault; Mode B account creation works
- [ ] ERC-8004 registry addresses on BSC confirmed (only if Phase 6 is planned)
- [ ] Organizers asked: mainnet requirement, Compass eligibility, IXS test environment, real redemption window
- [ ] G0 decision recorded in `DECISIONS.md`

---

## 19. Sources (re-check UNVERIFIED items before relying on them)

- Hackathon: https://www.openserv.ai/hackathon
- IXS launch post (vault address, human-sets-policy framing): https://x.com/IxsFinance/status/2075131181188653474
- IXS gitbook: https://ixs.gitbook.io/ixs-gitbook (Overview, IXS Agent Rail, Permissionless Vaults)
- Compass, Access the IXS Vault: https://docs.compasslabs.ai/v2/quick-guides/ixs-vault
- Finance District agent wallet design: https://fd.xyz/blog/design-principles-behind-our-agentic-wallet
- SERV docs index: https://docs.openserv.ai/llms.txt (Chat completions, SERV Tools, Structured outputs, Models)
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004 and https://github.com/erc-8004/erc-8004-contracts
- Usance (pattern source, README only): https://github.com/winsznx/usance
