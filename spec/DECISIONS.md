# Decisions

## 2026-09-21 — Phase 0 verification (gates G0, G1) and candidate choice

Source: on-chain reads against BSC mainnet via public RPC (bsc-rpc.publicnode.com) and
BscScan's contract-source API (verified source for the vault's implementation contract).
All values read live at approximately 2026-09-21T11:05 UTC. Re-check close to recording,
since several of these are admin-mutable.

### Vault identity (confirms/upgrades plan §4 ground truth)
- Proxy: `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82` (EIP-1967), implementation
  `0x96D16F6A266fa90702AA3e579ab87F983ceE9FF0`, verified contract name `ManagedVault`,
  Solidity 0.8.28, OpenZeppelin AccessControl + UUPS upgradeable.
- `asset()` = `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` — matches the plan's cited USDC
  address exactly, confirmed on-chain (not just from the Compass guide).
- Underlying and vault share decimals: both **18** (was UNVERIFIED belief in PLAN_v2 §4;
  now confirmed on-chain). Do not use 6.
- Symbol/name: `ixv1`.
- Live size: `totalAssets` ≈ 656 units, `totalSupply` ≈ 601 shares, `pricePerShare` ≈ 1.0912.
  Real but small — consistent with the plan's assumption.

### G0 — Mode A (contract depositor) viability: **PASS, currently**
- `deposit()` and `requestRedeem()` both call `_checkWhitelist(msg.sender)` /
  `_checkWhitelist(receiver)`. Source: `if (whitelistEnabled) require(whitelist[account], ...)`.
- `whitelistEnabled()` currently reads **false**. Deposits and redeem requests are
  permissionless today — an arbitrary contract (StewardAccount) can call `deposit()` directly.
- **Risk**: this is an admin-toggled boolean (`setWhitelistEnabled`, OPERATOR/ADMIN role). It
  can flip at any time with no notice. StewardAccount and the adapter must treat a whitelist
  revert as an expected failure mode (fail closed, surface it in the UI), and re-check this
  flag immediately before the demo recording.
- **Decision: build Mode A.** Fallback to Mode B only if whitelisting gets enabled before
  deployment.

### Additional gate not in the original plan — minimum deposit/redeem size: **BLOCKING, must fix numbers**
- `minDepositAssets()` = `minRedeemAssets()` = **100 units (100 USDC-equivalent, 18 decimals)**.
- PLAN_v3 §6.1's demo tier schedule (T0 `maxTx=5, maxVault=5`) and §9.1's honeypot pot
  ("for example $25") are **below the vault's own minimum deposit**. As specified, the demo
  cannot make its first real deposit.
- **Decision:** raise the demo tier schedule so T0's `maxVault` clears 100 (e.g. floor T0 at
  120–150) and fund the honeypot pot at 100+. Keep the *shape* of the tier ladder (T0 tiny,
  T3 largest) but anchor the floor to this on-chain constant instead of the illustrative "$5
  leash" language. Update the pitch line in PLAN_v3 §0 accordingly before recording the demo
  script (§13.1 references a "$5 leash," which needs the same fix).

### G1 — feed method: **PASS, better than the plan's ladder anticipated**
- The vault is **not** ERC-7540 (`supportsInterface` for the 7540 request-redeem interface
  ID returns false; none of the ERC-7540 view selectors exist — calls revert on missing
  function, confirmed by cross-checking against the verified source, which has no such
  functions).
- It has its own request/finalize model instead:
  `requestRedeem(shares, receiver) → id`, `redeemRequests(id) view → (owner, receiver,
  shares, priceAtRequest, feeBpsAtRequest, requestedAt, processedAt, status)`,
  `status ∈ {None, Pending, Finalized, Rejected}`, plus events `RedeemRequested`,
  `RedeemRequestFinalized`, `RedeemRequestRejected`.
- This is **directly and fully queryable on-chain, for every request since inception** — a
  strictly stronger source than any of the plan's four method labels
  (`FULFILL_EVENT` / `CLAIM_EVENT` / `OWN_REQUESTS` / `DOC_CONSTANT`). Add a fifth method
  label, e.g. `REQUEST_FINALIZE_VIEW`, and prefer it over `OWN_REQUESTS` sampling.
- **Real measured sample, read today:** 9 requests total since 2026-06-08, 2 currently
  pending, 0 rejected in this sample, 6 finalized with latency (`processedAt - requestedAt`):
  0.00h, 0.06h, 0.26h, 2.79h, 45.38h, **304.62h (~12.7 days)**. `n = 6`, clears the plan's
  `n >= 5` bar for using measured `p90` over the mandate's doc-constant lead time
  (PLAN_v3 §8.1).
  - p50 ≈ 1.5h, p90 is dominated by the 304.6h outlier — worth showing both the "typical"
    and "worst observed" numbers in the measurement report rather than collapsing to one
    figure, since n is small and the distribution is bimodal (minutes vs. ~2 weeks).
  - This single number — a real request that took **12.7 days** to settle on a vault whose
    marketing likely claims faster liquidity — is a strong, concrete instance for the pitch's
    "vendor claims vs. measured behavior" contrast (PLAN_v3 §0, §7.5 item 4). Get the actual
    claimed lead time from IXS/Compass docs at recording time and quote it side by side.

### Liquidity and NAV facts relevant to the Health Feed spec (§7)
- `availableAssets()` (liquid in the vault contract right now) ≈ **2.66** units against
  `totalAssets` ≈ 656 — under 0.5% immediately liquid. Nearly all capital sits at
  `custody()` = `0x5c79bC277F2e02Dc667dE4EEcbB05Aa8fC24F6aF`, an operator-controlled address
  (`AssetsForwardedToCustody` event, `sweepTokenToCustody`). This matches the
  "operator-settled, no instant sell" description from the Compass guide and is exactly the
  fact the Health Feed exists to surface.
- NAV is **admin-attested, not computed**: `setNAV(uint256)` gated by `NAV_MANAGER_ROLE`,
  `NavUpdated` event, `isNavFresh()` currently true, `navStalenessThreshold` = 172,800s (2
  days), last update 2026-09-21T00:22 UTC (~11h old at read time). `maxNavChangeBps` = 5000
  (50%) — a single NAV update can move price per share up to 50% before any on-chain
  circuit breaker fires. Flag this explicitly in the "real vs simulated" honesty table: the
  Health Feed measures redemption latency from real events, but NAV itself is a trusted
  input from the vault operator, not independently verifiable on-chain. `CODEHASH_CHANGED`
  and `NAV_STALE` flags (PLAN_v3 §7.2) are the right mitigations already in the spec — keep
  them.
- Vault's own protocol fee: `feeBps()` = 50 (0.5%) on redemption, separate from Steward's own
  fee-on-yield module (PLAN_v2 §2.1) — do not conflate the two in the README fee description.

### G2 — ERC-8004 registry addresses on BSC
Not checked (optional bridge item, Phase 6 reach scope per PLAN_v3 §12). Deferred.

### Candidate decision
Chosen candidate: **6 (v3 = candidate 3 + 4 + 5 + honeypot)**, per PLAN_v3 §2.
Both hard gates that could have forced the ~76-point fallback (Mode A, feed readability)
came back positive, and G1 came back *better* than the plan's own ladder assumed (full
request history beats own-request sampling). The only correction needed is numeric, not
architectural: the demo tier schedule and honeypot pot must be raised to clear the vault's
100-unit minimum deposit/redeem.

Tradeoff accepted (per PLAN_v3 §2): breadth of v3's scope (ConductRegistry, VaultHealthFeed,
honeypot, on top of v2's full envelope) against 7 remaining days (today 2026-09-21, submissions
close 2026-09-28T00:00 UTC). Re-verify whitelist status and vault liquidity again just before
the demo recording, since both are operator-mutable and outside our control.

## 2026-09-21 — No personal funds; zero-funds path is the plan of record

**Decision:** the builder is not spending personal money on this project. No real deposit,
no real honeypot bounty, no live BSC mainnet broadcast. Development and the demo both run
against a local mainnet fork (Anvil/Foundry, pinned to real BSC state) of the actual
`ManagedVault` at `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`. Cost: $0 — a fork never
broadcasts, so nothing is spent regardless of how heavily it's used; this was already the
right tool for Phase 1–3 testing independent of the funding question.

**Correction to the prior scoring language in this document and in conversation:** the
"91/100 target," the six-check ceiling table, and its per-check point deductions (PLAN_v3
§0, §3) are a **self-invented rubric from the plan's own author, not OpenServ's judging
criteria**. Referring to lost points from going zero-funds as a "rubric" cost overstated
its authority — it should have been flagged as an internal heuristic, not an external score.

OpenServ's actual published judging criteria (openserv.ai/hackathon#tracks) are only:
**creativity, user-readiness, revenue potential.** Nothing about "real stakes" or "public,
third-party-verifiable on-chain state" appears there. Going zero-funds does not cost fixed
points on an official scale; it's a judgment call about how convincing a fork-only demo
reads on those three actual axes, mainly user-readiness (a well-produced fork demo with an
honest write-up can still read as fully working).

**Consequences for the plan, locked in:**
- Live deployment → fork-only. The `/simulate` page (PLAN_v2 §12, originally a no-wallet
  fallback for judges) becomes the primary demo surface, backed by the fork.
- Honeypot → category A/B/C logging and leaderboard kept; no real bounty, no real payout.
  Present it as an illustration of the attack surface, not a real-stakes claim.
- Vault Health Feed is unaffected — computing p50/p90 latency from the vault's real
  historical `redeemRequests` (already pulled: n=6 finalized, one 304.6h/~12.7-day outlier)
  is free RPC reads, no funds required, and stays fully real data either way.
- README/honesty table gets an explicit line: "Built and demoed against a pinned mainnet
  fork of the real IXS vault; not independently checkable by a third party from public
  chain data; no real funds were placed at risk."
- Track-eligibility question (RWA Vaults track requires "with IXS") is not at risk here,
  since the fork targets IXS's actual contract and state — the earlier eligibility concern
  applied only to the self-deployed-mock-on-testnet alternative (Option B), which is now
  out of scope and not being pursued.

## 2026-09-22 — Phase 2 (contracts): built, self-audited, and G0 closed empirically

Foundry installed (`forge`/`anvil`/`cast` v1.8.3, native Windows binaries — works fine,
`serv PLAN_v2.md`'s "run Foundry inside WSL" assumption wasn't needed). Contracts project at
`contracts/` (`forge init` style; `lib/` gitignored rather than tracked as git submodules,
since the repo had zero commits when Phase 2 started and `forge install`'s
`git submodule add` requires a valid HEAD — see `contracts/setup.sh` for the reproducible
fetch instead).

**Built:** `StewardAccount`, `StewardFactory`, `ConductRegistry`, `VaultHealthFeed`,
`ManagedVaultAdapter` (+ `IManagedVault`/`IVaultAdapter` interfaces), and the `PolicyMath` /
`TierEngine` / `HealthMath` / `Types` libraries mirroring `spec/accounting.md` and
`spec/tiers.md` field-for-field. No fee-on-yield module (Phase 6 cut, per the plan's own cut
order). No `claim()` — Phase 0 found the real vault pays out automatically to `receiver` on
an operator-only `finalizeRedeem`, so there's no separate claim step for the depositor;
`reconcileRedemption` (which verifies the vault's own `Finalized` status on-chain before
touching `exposure` — see the bug list below) replaces it.

**Self-review before writing tests found and fixed 6 real bugs**, all fixed before any test
was written against them:
1. `reconcileRedemption` never checked the vault's actual redemption status — an agent or
   guardian could have shrunk `exposure` (unlocking more deposit capacity) for a still-
   pending request. Now reads `IManagedVault.redeemRequests(id).status` on-chain and reverts
   if not `Finalized` (onchain-access-control check 3: recompute, don't trust the claim).
2. `tightenCap`/`raiseReserve` silently no-op'd on the wrong direction while still emitting
   a success `Decision` receipt — a receipt that misrepresented what actually happened
   on-chain. Now revert (`NotATighteningMove`/`NotARaisingMove`) instead.
3. `graduate()` read `tierState.riskAcc` before accruing it to the current timestamp, so the
   `riskUnits` reported in the `Graduated` event / `ConductRegistry.report` call could
   understate (even fall below) the figure `checkPromotion` had just used to decide
   eligibility. Now accrues into storage first.
4. `HealthMath.deriveHealthCap`'s staleness check (`nowTs - s.ts > maxStaleSec`) only
   correctly failed closed on a never-published snapshot (`ts == 0`) by accident of real
   chain timestamps being astronomically larger than `maxStaleSec` — it silently broke in
   any environment where `block.timestamp` starts small (a fresh test chain, a fresh fork).
   Fixed with an explicit `s.ts == 0` check, and mirrored into `health.ts`/`health.py` for
   three-way parity (P-08) since the same latent issue existed there too, just unlikely to
   manifest against `Date.now()`. Also fixed: a future-dated `s.ts` (never legitimate)
   previously could underflow-revert in Solidity (denial of service on every deposit)
   instead of failing closed to `healthCap = 0`.
5. `StewardAccount`'s constructor never validated `startTier`, so a bad value would
   permanently brick the account (every function calls `Types.tierLimits(tierState.tier)`,
   which reverts on an out-of-range tier). Not reachable via `StewardFactory`, but cheap to
   guard for anyone deploying directly (tests, a future factory).
6. `receiptsSinceEntry` (spec/tiers.md "min receipts") was only incremented by `deposit()`.
   Phase 1's off-chain engine defines `recordReceipt` as a primitive but never built the
   orchestrator that decides when to call it, so this was a genuine open design question,
   not a spec transcription — resolved by incrementing on every *operational* action
   (deposit, requestRedeem, reconcileRedemption, logDecision), not on envelope-control
   actions (tighten/raise/pause/loosen), documented in `StewardAccount`'s contract-level note.

**Tests:** 49 unit tests (`StewardAccount`, `ConductRegistry`, `VaultHealthFeed`,
`StewardFactory`, `HealthMath` incl. a 256-run fuzz check of invariant O-13) + 1 invariant
suite (16,384 random calls, 5 invariants, 0 failures) + 4 fork tests, all green.

**G0 (Mode A) closed empirically, not just inferred:** `contracts/test/fork/ModeA.t.sol`
runs against a local `forge test --fork-url` state fork of live BSC — no transaction ever
broadcast to the real chain, no real funds spent (`deal()` writes a fake USDC balance into
the fork's local storage only). Confirms `StewardAccount.deposit()` and `.requestRedeem()`
actually succeed against the real vault, not just that `whitelistEnabled()` reads `false`.
**New finding from this run:** depositing 120 USDC minted ~109.98 shares, not 120 — the real
vault is confirmed NOT 1:1 NAV (matches Phase 0's `pricePerShare` ≈ 1.0912 reading). Caught
as a bug in the fork test itself on first run (it wrongly assumed 1:1, matching the mock
used in unit tests) — `ManagedVaultAdapter` itself was always correct, reading shares back
from the vault rather than assuming a ratio.

**Not done in Phase 2** (see `docs/LIMITATIONS.md` for the full list): full O-01..O-18
invariant coverage (5 of 18 covered by the invariant suite so far — O-02/O-03/O-06/O-08/O-12
in simplified form; the rest need `requestRedeem`/reconcile/loosen paths and a multi-account
setup the current handler doesn't drive), Slither, and no deployment of any kind — this
entire phase ran locally against mocks and a read/fork-only connection to real BSC, per the
zero-funds decision above and the explicit instruction not to deploy.

## 2026-09-22 — Phase 3, first slice: evidence engine + live health indexer

Scope for this entry: the deterministic claim-grounding/corroboration layer (PLAN_v2 §8,
`spec/evidence.md`, new) and a real, reproducible live health-snapshot reader
(`scripts/live-health-snapshot.ts`). The SERV network client (proposal reasoner + the actual
two-model claim-extraction call) and the eval harness are **not** in this entry — see the
"deferred" note at the end.

**Finding, not a decision:** `packages/engine/src/accounting.ts`'s `evidenceHealthMultiplierBps`
(the effect-table math: stale/corroborated-severe-adverse/single-path-adverse → 0/0.5/1×
health) was already built and differential-tested in Phase 1, ahead of the claim pipeline that
was supposed to produce its inputs. That pipeline — fetch, ground, corroborate — did not exist
until now; `EvidenceState` was being constructed by hand in fixtures, never derived from raw
model claims. `spec/evidence.md` and `packages/engine/src/evidence.ts` /
`packages/engine-py/steward_engine/evidence.py` close that gap.

**Design decisions the plan left open, recorded here (spec/evidence.md has the full text):**
1. "Severe" (PLAN_v2 §8.2's effect table uses "severe type" without defining it) is
   `severity == "HIGH"` on the individual claim, not a fixed property of `type` — the model
   grades severity per-claim; a model that always emits `HIGH` gains nothing because severity
   alone never triggers an effect, only `HIGH` + `ADVERSE` + `CORROBORATED` together do.
2. Corroboration requires the two models' grounded quotes to occupy overlapping character
   ranges in the normalized source, not just matching `(type, polarity)` — deliberately harder
   to game than shape-matching alone (spec/evidence.md §3.4, §6).
3. `evidenceSnapshotId` (referenced in `spec/accounting.md`'s canonical `policyInput` encoding
   since Phase 1 but never defined) is `hashClaimSet(groundedClaims)`: sha256 over a canonical,
   order-independent serialization, same pattern as `spec/health.md`'s `evidenceHash`.

**Wiring into `checkDeposit`:** `ADVERSE_CLAIM`/`UNGROUNDED_CLAIM` (`ReasonBit` 12/13) existed
in the canonical reason-code encoding since Phase 1 but nothing ever set them. Added as two new
`DepositCheckInputs` fields (`adverseClaimPresent`, `ungroundedClaimPresent`), flattened
booleans passed in the same style as the existing `evidenceFresh` — **caught and fixed a bug
in my own first draft before it shipped**: my first version pushed these two bits into the same
list that decides `REFUSE`, which would have force-refused every deposit touched by so much as
a single-path adverse claim or a dropped ungrounded claim, contradicting
`spec/evidence.md`/PLAN_v2 §8.2's explicit "no forced exit" for single-path adverse claims.
Fixed by splitting `checkDeposit`'s bits into `refuseBits` (decide the verdict) and `infoBits`
(surfaced on the receipt for owner visibility, never gate the verdict on their own) — mirrored
in both `policy.ts` and `policy.py`. Regenerated `fixtures/differential/deposit_cases.json`
with new cases isolating exactly this (`info_adverse_claim_present_still_allow`,
`trigger_over_capacity_from_adverse_claim_health_cut` — the latter shows the *correct* path an
adverse claim blocks a deposit: through the health-multiplier capacity cut, not through the
informational bit).

**Live re-verification, not just a fixture:** `scripts/live-health-snapshot.ts` runs the same
`buildRequestFinalizeSnapshot` the differential suite already covered offline, but against the
real vault via `cast call`/`cast implementation`/`cast codehash` (read-only, no key, nothing
broadcast — same treatment as `contracts/test/fork/*.t.sol`). Result at BSC block 123,335,856:
`n=6` finalized, `p50Sec=926` (≈0.26h, matches the Phase 0 note), `p90Sec=maxSec=1096620`
(≈304.6h). **Correction to `spec/health.md`'s Phase 0 note in the same pass:** it said "`n = 9`
total requests" — `nextRedeemRequestId()` reads `9`, but that's the *next* id to be assigned;
`8` requests actually exist (ids 1–8). `n` in the `HealthSnapshot` struct is the finalized
count (`6`), which the note already got right elsewhere — only the "9 total requests" phrase
was imprecise. Fixed in `spec/health.md` directly rather than left standing now that it's been
re-derived live and the discrepancy is visible.

**`docs/measurement-report.md` (new):** the measured side is filled in from the live run above.
The claimed side (what IXS/Compass actually publish as the redemption terms for this vault) is
explicitly left as an unfilled TODO, not guessed — Phase 0 flagged this sourcing step and it
was never done; PLAN_v3's honesty rule (never present a doc constant as a measurement) cuts
both ways: don't present a guess as a claim either.

**Incidental fix, unrelated to the above but found while running the required checks:**
`eslint.config.js` never excluded `contracts/lib/` (the gitignored, fetched Foundry
dependency — forge-std, OpenZeppelin test suites) from lint scope. `pnpm lint` was clean
earlier only because `contracts/lib/` was empty at the time; once populated
(`contracts/setup.sh`) it produced ~4,700 lint errors against vendored code that isn't ours.
Added `contracts/lib/**` to `ignores`, same treatment as `node_modules/**`.

**Deferred to a later Phase 3 entry:** the SERV network client (proposal reasoner, the actual
two-model claim-extraction HTTP calls, `serv_prompt_guard`/`serv_shadow_agent` tool behavior),
the eval harness (`make eval`), `examples/naive-agent`. The SERV client specifically needs
measured timeout/retry/tool-use behavior per `CLAUDE.md`'s external-API rule before it's
trusted, and that measurement needs `SERV_API_KEY` — which this agent does not and will not
read from `.env` (`CLAUDE.md`: "Don't read `.env*`, keystores, or secret directories"). See
`docs/API_NOTES.md` for exactly what's measured vs. still assumed.

## 2026-09-22 — Phase 3, second slice: SERV client, naive-agent example, eval harness

Continuation of the same day's Phase 3 work, closing out everything from the "deferred" note
above except the live measurement itself (still genuinely blocked on `SERV_API_KEY`, which
this agent does not read).

**Decision: build the SERV client ahead of full measurement, not after it.** `CLAUDE.md`'s
rule is "spend real time... mapping failure modes... before writing the client." Read
literally that blocks all progress here, since the mapping needs a live key this agent
doesn't have. Resolution: PLAN_v2 §9's own design — "fail closed: schema violation, failed
shadow output, timeout, refusal or empty content becomes HOLD with MODEL_FAILED_OUTPUT" —
means an unmeasured transport assumption is safety-bounded by construction: getting a retry
count or timeout value wrong costs latency or SERV credits, never a wrong capacity decision,
because every transport failure collapses to the same safe `HOLD`/stale outcome regardless of
*why* it failed. Built `packages/serv-client` on that basis: every unmeasured value (timeout,
retry count, tool-use wire format) is a comment literally saying `ASSUMPTION`, not stated as
fact; `docs/API_NOTES.md` was updated to point at `scripts/live-serv-probe.ts` as the explicit
action item to close the gap. The one place this discipline mattered most: `serv_prompt_guard`
and `serv_shadow_agent`'s actual request/response shape is unknown, not just untuned — so
`packages/serv-client` does **not** wire fake tool-use support (that would be a guess dressed
as a feature); `scripts/live-serv-probe.ts` instead sends an exploratory OpenAI-standard
`tools` array and reports back whatever SERV actually does with it.

**`packages/serv-client/src/reasoner.ts`'s `validateProposal`:** enforces CLAUDE.md's
"the model never receives a code path that can name an address, produce calldata, set a
limit, or raise capacity" two ways at once — the `ReasonerProposal` type has no such field,
and the validator explicitly rejects any object with an unexpected extra key. The type-level
protection alone would already stop real code from using a smuggled field, but wouldn't stop
one from silently sitting in a log or a receipt; the runtime rejection makes the smuggle
attempt itself visible as a hard failure. Tested directly (`address`/`calldata`/`limit`
smuggle attempts, `packages/serv-client/test/reasoner.test.ts`).

**`packages/serv-client/src/extraction.ts`'s stale-on-partial-failure rule:** if either of the
two model calls fails, the result is `stale: true` (spec/accounting.md §4: capacity 0), never
a silent fallback to "the one model that answered found nothing adverse." Corroboration
inherently needs two independent calls; treating a partial failure as equivalent to a clean
double-check would quietly weaken the exact defense (single-model hallucination protection)
the two-model design exists for. Tested directly
(`packages/serv-client/test/extraction.test.ts`).

**`examples/naive-agent`:** deliberately does not import `@steward/engine` — it shells out to
`scripts/live-health-snapshot.ts` and makes its own DEPOSIT/DECLINE call from the result,
demonstrating the health feed's value to any consumer, not just Steward's own tiering
machinery (spec/health.md §6 item 3: "independent code, no Steward contracts"). Run live
against the real vault: declines, correctly, citing the measured ~304.6h p90 against its
3-day default threshold — the "vendor claims vs. measured behavior" pitch contrast working
end to end, not just asserted.

**Eval harness split into offline and live halves**, not built as one script, because they
need genuinely different trust levels: `scripts/run-eval-offline.ts` (`make eval`) feeds
`eval/scenarios.json`'s 21 hand-curated adversarial/legitimate payloads directly into the
deterministic defenses (no network, no key) and is run and green (21/21) as part of this
entry. `scripts/live-eval.ts` (`make live-eval`) is the real "raw vs guarded vs
guarded+policy" comparison PLAN_v2 §13 point 7 asks for — built, complete, but not run, same
reason as the probe script. Neither is the full "100 scenarios including the adversarial set"
PLAN_v2 asks for; 21 is a real starter set, not a finished one — recorded honestly in
`docs/LIMITATIONS.md` rather than rounded up.

**What's left for Phase 3 to be fully closed** (see `docs/LIMITATIONS.md` for the complete,
current list): running `make live-serv-probe` and `make live-eval` with a real key and folding
the findings back into `docs/API_NOTES.md`/`client.ts`'s `ASSUMPTION` comments; sourcing the
"claimed liquidity" side of `docs/measurement-report.md` from an actual IXS/Compass quote;
growing the eval scenario set toward the plan's 100; and wiring `serv_prompt_guard`/
`serv_shadow_agent` for real once their wire format is known. None of these block calling
Phase 3 "done" for the parts that don't require spending the repo owner's SERV credits or
reading their `.env` — everything else in this entry and the previous one is real, tested,
and (where it touches the live vault) actually run.

## 2026-09-22 — Phase 3 review round: two real test-coverage gaps found and closed

Ran both required review gates (`dx-auditor`, `reliability-auditor`, `CLAUDE.md`'s review-gate
rule) against the full Phase 3 diff. `dx-auditor` passed outright, confirming cold
`pnpm install`/`lint`/`typecheck`/`test`/`build`, CI coverage, and that all four live/network
scripts stay correctly excluded from the default path; it flagged one already-documented,
non-blocking gap (`docs/LIMITATIONS.md`'s "Guardrails are documented, not yet enforced as
code" section — no CI tripwire for the `.env`/network-script conventions, held by review only).
`reliability-auditor` returned FAIL with two real findings, both fixed in this entry, plus one
correctly-scoped-as-later item:

1. **`evidenceHealthMultiplierBps` (`packages/engine/src/accounting.ts`, mirrored in
   `accounting.py`) had zero test coverage anywhere.** This is the function P-07 and
   `spec/evidence.md` §5 actually depend on — the mechanism that turns `EvidenceState` into
   the 0/0.5/1× capacity multiplier. My own 2026-09-22 first-slice entry above claimed it was
   "already built and differential-tested in Phase 1"; that claim was wrong — the differential
   deposit fixtures hand-inject `healthMultiplierBps` directly, bypassing the function
   entirely. Fixed: `packages/engine/test/accounting.test.ts` +
   `packages/engine-py/tests/test_accounting.py`, 8 tests per language, one per branch
   (stale, corroborated-severe-adverse, severe-wins-over-single-path, single-path-adverse,
   latency-exceeds-lead-days, drawdown-at-half-threshold, drawdown-at-full-threshold, clean).
2. **The `checkDeposit` refuseBits/infoBits split — the exact bug my first draft shipped and
   caught by hand — had no test that would fail if the fix were reverted.** The only coverage
   was `scripts/diff-check.mjs`'s TS-vs-Python string comparison, which can't catch a
   regression mirrored identically into both languages at once (and `policy.py`'s own header
   says "mirrors policy.ts exactly," which is precisely how such a regression would get
   introduced — fixing one file and copying the "fix" to the other). Fixed:
   `packages/engine/test/policy.test.ts` + `packages/engine-py/tests/test_policy.py`, asserting
   `verdict === ALLOW` (not just bit equality) when `adverseClaimPresent`/`ungroundedClaimPresent`
   is the only thing present and headroom still covers the amount. **Verified the fix actually
   catches the regression, not just asserted it would:** deliberately reintroduced the exact
   bug (moved `ADVERSE_CLAIM`/`UNGROUNDED_CLAIM` back into `refuseBits`) in both `policy.ts`
   and `policy.py` in turn, confirmed the new tests failed in each language, then reverted.
3. **No logging sink for any `packages/serv-client` failure path** (a timeout, a malformed
   body, an ungrounded claim) — correctly scoped as a Phase 4 item, not fixed now: the
   orchestrator that would do this logging doesn't exist yet (`serv PLAN_v3.md` §11), so
   building a logging call with nothing real to wire it to would be speculative. Recorded in
   `docs/LIMITATIONS.md` as a requirement on whoever builds that orchestrator, with the
   specific shape it needs to log.
4. **Stale doc, not a code bug:** `docs/API_NOTES.md`'s `cast` section still said
   `execFileSync` had no timeout, which had already been fixed (`CAST_TIMEOUT_MS = 15_000`,
   added during this same day's build after an earlier self-review pass) — the doc just never
   got updated when the code changed. Fixed in this entry's pass.

`reliability-auditor` also explicitly confirmed, independent of the two gaps above, that
`eval/scenarios.json`'s `expected` values are correct derivations of the actual code (hand-traced
two scenarios independently) rather than accidentally-matching a bug — the 21/21 pass from the
first entry is real signal, not a tautology.

## 2026-09-22 — `live-serv-probe` actually run; one design guess falsified with real data

The repo owner ran `pnpm run live:serv-probe` themselves (this agent still did not read
`.env` — see the two entries above for why). Found in the process: neither `Makefile` nor
`package.json` originally loaded `.env` into the process at all (no `dotenv`, no
`--env-file`), so the first attempt failed with `SERV_API_KEY is not set` even with a real
key present. Fixed by adding `--env-file-if-exists=.env` to the `live-serv-probe`/`live-eval`
invocations (both `Makefile` targets and new `package.json` scripts `live:serv-probe`/
`live:eval`/`live:health`, added for shorter, less error-prone typing — `--env-file` fails
hard if the file doesn't exist, so `measure-health`, which needs no key, deliberately did
**not** get this flag).

Real findings (full detail in `docs/API_NOTES.md`): 7 live calls, latency 0.68s-6.1s, no rate
limit at a 5-call burst, default model resolves to `gpt-5.4-mini-2026-03-17`. The one finding
that changes shipped behavior: `tools: [{type: "serv_prompt_guard"}]` — the exploratory guess
`scripts/live-serv-probe.ts` and `scripts/live-eval.ts` both shipped with — gets a clean `400`:
`"Supported values are: 'function' and 'custom'"`. The endpoint does speak OpenAI-standard
tool-calling; `serv_prompt_guard`/`serv_shadow_agent` are just not literal `type` values
within it. This is exactly the outcome the "build ahead of measurement, fail closed either
way" decision (first entry above) was designed for: the guess was wrong, and the only
consequence was a wasted exploratory probe call, not a bad capacity decision — nothing in
`packages/engine`/`packages/serv-client`'s actual policy logic depended on that guess being
right. Fixed `scripts/live-eval.ts`'s "guarded" arm to stop sending the now-confirmed-broken
payload (it would have 400'd every guarded-arm call, silently producing meaningless eval
data rather than an honest error) and added a follow-up exploratory probe
(`tool_use_custom_type_exploratory`) trying the OpenAI "custom tool" shape as the next guess,
clearly still labeled as unconfirmed. The real wire format remains unknown — resolving it
needs either SERV's actual docs or another probe iteration, not another guess from this
agent.

## 2026-09-22 — `live-eval` actually run: 0% unsafe rate, one real (non-bug) schema finding

The repo owner ran `pnpm run live:eval` — 30 live calls (10 scenarios × 3 arms), real spend.
Full numbers in `docs/API_NOTES.md`. This closes the last "built but not run" item from
Phase 3's earlier entries.

**Headline result: `unsafe_rate` (a smuggled `address`/`calldata`/`limit` field surviving
`validateProposal`) was 0% across all 30 calls, all three arms.** This is the first time that
specific claim — the direct code-level enforcement of `CLAUDE.md`'s "the model never receives
a code path that can name an address, produce calldata, set a limit" invariant — was checked
against real SERV model output rather than only the synthetic payloads in
`eval/scenarios.json`/`packages/serv-client/test/reasoner.test.ts`. It held.

**One real finding, correctly not treated as a bug:** `guarded_policy`'s `schema_valid_rate`
was 90% (9/10), not 100%. Scenario `duplicate_claim_self_corroboration_attempt`'s live model
call returned `"action": "hold"` (lowercase) instead of the schema's exact `"HOLD"`;
`validateProposal` rejected it (`SCHEMA_VIOLATION: action must be DEPOSIT|REDEEM|HOLD, got
"hold"`). Decision: **do not loosen the validator to accept case-insensitive enum values.**
The strict, exact-match check is what caught this — a model that doesn't reliably respect the
schema's exact casing is exactly the failure mode `proposalFromModelOutput`'s fail-closed
design exists for, and the reduced-schema-validity number is the validator doing its job, not
failing at it. If this is worth tightening, the fix is prompt-side (state casing more
explicitly in `scripts/live-eval.ts`'s `PROPOSAL_SCHEMA_INSTRUCTIONS`, and eventually in the
real Phase 4 reasoner prompt), never validator-side — erring toward more `HOLD`s from stricter
validation is the safe direction, and loosening it to reduce false rejections would trade
safety for a marginally higher pass rate on exactly the axis this project cannot afford to be
loose on.

**Caveats recorded so the 0% isn't overclaimed:** `raw`/`guarded` arms' 100%
`schema_valid_rate` measures something narrower than `guarded_policy`'s (absence of a
disallowed field only, not full schema conformance — no `validateProposal` call in those two
arms, by `scripts/live-eval.ts`'s own design) — not apples-to-apples with `guarded_policy`'s
number. And the `guarded` arm currently sends no `tools` field at all (per the prior entry's
`serv_prompt_guard` wire-format finding), so `raw` and `guarded` being identical here says
nothing about what the guard would buy once its real invocation shape is found. Finally, none
of these 10 scenarios were written as reasoner-targeting prompt injections — they're
`eval/scenarios.json`'s evidence-grounding scenarios reused as documents, not a corpus
designed to attack the proposal schema specifically. A 0% unsafe rate against a stronger,
purpose-built adversarial set (part of the still-open "grow toward 100 scenarios" item) is a
meaningfully stronger claim than this run makes, and `docs/LIMITATIONS.md` says so.

## 2026-09-22 — Phase 4: real T0->T1 graduation on a persistent mainnet fork

**Scope reframed before building anything**, per the user's own question: `serv PLAN_v3.md`'s
Phase 4 literally says "small real deposit" — read alone, that reads as a real mainnet
deployment. It isn't, and shouldn't be: the Phase 0 entry above already locked in "Live
deployment -> fork-only" and explicitly rejected a testnet deployment as an alternative
(a testnet deployment can only reach a mock vault, never the real IXS contract, which defeats
the whole point). `CLAUDE.md` also states this as a standing engineering rule ("don't deploy
to mainnet from an agent session"), not just a one-off instruction. So Phase 4 here means:
the same real contracts, deployed onto a **persistent** local fork (not the disposable
per-test fork `contracts/test/fork/*.t.sol` already used), driven by a real executor over
real (fork) time, with a real "same request, two agents" contrast — everything Phase 4 asks
for except the literal mainnet broadcast and the real dollars.

**Built:** `scripts/fork-node.sh` (persistent Anvil fork, `--dump-state`/`--load-state` so
history survives restarts — pins a fresh block and records it unless `--fresh` is omitted);
`contracts/script/DeployDemo.s.sol` (deploys the full stack, creates Agent A at T0, uses
Anvil's well-known public dev accounts for owner/agent/guardian — safe only because they hold
nothing anywhere except this local fork); `scripts/demo-driver.ts` (the executor: one
qualifying deposit, nine `logDecision` receipts, a real `evm_increaseTime`/`evm_mine` clock
advance, `graduate()`, then Agent B created fresh and the contrast deposit from both);
`scripts/replay-fork-demo.ts` (independent verification — confirms every tx hash still
resolves and recomputes the graduation predicate via `packages/engine`); `LIVE.md` (the
honesty-table writeup the plan's Phase 4 exit criteria asks for).

**Result, actually run, not simulated:** Agent A graduated T0->T1 on real on-chain state
(`tierState()` read back `tier=1`). The contrast: both agents asked to deposit 200 units —
Agent A (T1, `maxTx`=300) succeeded (tx `0x6807e5a8f29019cb849a1c64a2a664621e0010e2b060d8cdb99296bcac1022a9`);
Agent B (T0, `maxTx`=120) reverted with `OverMaxTx`, during gas estimation, never even
broadcast. `scripts/replay-fork-demo.ts` independently confirmed both: all 13 real tx hashes
still resolve after a full fork shutdown-and-reload cycle, and `packages/engine`'s
`checkPromotion`, fed the actual on-chain `TierState` and block timestamp, agrees the
promotion was legitimate — a second, independent computation, not a re-assertion of the
contract's own claim.

**Funding without a cheatcode that doesn't persist:** the obvious first approach —
Foundry's `deal()` — doesn't work here. `deal()` only affects `forge script`'s local
simulation before broadcasting; it has no corresponding transaction, so it never reaches the
actual persistent Anvil node's real state. Used `anvil_impersonateAccount` on a real, large
holder of the vault's underlying token (Binance Hot Wallet 20, a publicly documented address,
found by checking `balanceOf` on a few candidate addresses live against the fork) plus a real
`transfer()` instead — a completely standard Anvil workflow, still 100% local-fork-only, and
arguably more honest than a storage cheat since it's an actual token movement the EVM
processes normally.

**Real bugs found and fixed while building this, not glossed over:**
1. **Hand-transcribed Anvil dev private keys were wrong** (truncated by one or two hex
   characters each, for every account except account 0) — caught immediately by a live
   "Failed to decode private key" error before any state-changing call was attempted. Fixed
   by copying every key directly from `anvil`'s own startup log, never from memory, with a
   comment in `scripts/demo-driver.ts` saying so.
2. **A seq-desync retry bug.** The free RPC endpoint this fork forks from intermittently
   returns "archive requests require a personal token" even on calls that had already
   succeeded on-chain — confirmed directly (`nextSeq()` had already advanced despite `cast`
   reporting failure). A first-draft retry wrapper blindly resent the identical command,
   which then failed with `BadSequence` on the retry (the real sequence had already moved).
   Fixed with `robustSend`: every retry re-derives its arguments fresh, and before treating an
   error as retryable, re-checks a probe (usually `nextSeq()`, `tierState().tier` for
   `graduate()`, or `ConductRegistry.recordOf(agent).accountsCount` for `createAccount`) — if
   the probe moved, the action already landed and this returns a synthetic
   "succeeded, tx hash unknown" result instead of resending.
3. **`fundFromWhale` was silently over-funding.** Its `cast send ... --from WHALE --unlocked`
   call for this specific real, heavily-used whale address reports failure on essentially
   every attempt (100% in testing) while the transfer itself always actually lands — retrying
   it (the natural fix for problem 2's pattern) just repeated the transfer every time,
   confirmed directly: one test round produced `2750000000000000000000` (2750 units) in an
   account meant to hold 250, exactly 11× the intended amount. Fixed by trying the call
   exactly once, swallowing its (expected) error, and verifying the real outcome via the
   recipient's actual balance delta — the only thing that matters here — rather than trusting
   this specific call's own success/failure report.
4. **`cast logs` without `--from-block` scans from genesis** on a ~123-million-block chain,
   which reliably needs archive access — this, not generic flakiness, was the actual root
   cause of the Agent-B-address lookup failing far more consistently than every other call in
   the script. Retries alone could never fix a query that's *always* out of range. Fixed by
   scoping the query to the fork's own pinned starting block
   (`.fork-state/pinned-block.txt`, written by `scripts/fork-node.sh`).

**Mandate values matter for what a demo can show, not just correctness:** the first draft of
`contracts/script/DeployDemo.s.sol` set Agent A's mandate `maxVaultUsdc`/`envelope.capacityCap`
to T0's own 150-unit ceiling — which would have silently capped Agent A at 150 units forever,
making tier graduation invisible even after `graduate()` succeeded (the tier's higher limit
would never bind, since the mandate ceiling was already the tightest constraint). Caught
before running the driver, not after: `spec/tiers.md` section 5's "effective limit = min(tier
limit, mandate ceiling, ...)" means the mandate has to be *generous* (here, set equal to the
account-level `hardCap`) for the tier to actually be the interesting, binding constraint the
demo is supposed to show earning.

**What this doesn't claim:** `LIVE.md` states plainly that this is not checkable on a public
block explorer (there is no public transaction), that real mainnet gas/MEV/reorg conditions
are untested, and that reproducibility (reload the same state dump, get the same result) is a
different, weaker claim than public verifiability — offered as exactly that, not padded to
sound stronger.

## 2026-09-22 — Phase 5, first slice: the Verifier, built and confirmed live

**Scope decision:** Phase 5 (`serv PLAN_v3.md` §12: verifier, no-wallet Simulate, the full
wallet-connected live app, honeypot) is a genuinely large build — asked to do "everything in
plan order." Started with the verifier specifically because the plan itself protects it
("do not cut: ... verifier ...") and because it's the piece that makes every claim in `LIVE.md`
independently checkable rather than merely asserted.

**Stack: Next.js, not the Vite+React this agent defaulted to before being corrected.** Scaffolded
`apps/web` (`create-next-app`, App Router, TypeScript, Tailwind v4) and added it to the pnpm
workspace (`apps/*`, alongside the existing `packages/*` glob). Two real config gaps found and
fixed immediately: the root `eslint.config.js` had no `apps/**` exclusion, so `pnpm lint`
tried to lint Next.js's own build output (`apps/web/.next/**`) with a bare TS config lacking
browser globals — ~4,575 spurious errors, same class of issue as the `contracts/lib/**` fix
from Phase 3; and `apps/web/tsconfig.json`'s default `target: "ES2017"` doesn't support BigInt
literals, which `@steward/engine` (now a real workspace dependency of `apps/web`, imported
unmodified via `transpilePackages`, not reimplemented) uses throughout — bumped to `ES2022`
matching the root config, and added `allowImportingTsExtensions` since that package's own
source imports its siblings with explicit `.ts` extensions.

**Design system:** researched current (2026) UI trends before writing any component — cream/
off-white minimalism vs. dark-mode-neon-crypto were the two live directions found; chose the
former per the user's explicit ask and because it fits this project's actual positioning
(a sober, measured-not-vibes tool) better than a crypto-dashboard aesthetic would. Palette:
cream base (`#F6F1E7`), white surfaces, warm dark ink text, blue (`#2F6690`) and green
(`#3E7C6A`) as the requested accents, with semantic verdict colors (green/red/amber for ALLOW/
REFUSE/NEEDS_APPROVAL) kept deliberately distinct from those two brand accents so a verdict
badge can never be confused with a nav element. Typefaces: Space Grotesk (display) + Manrope
(body/data) — chosen specifically to avoid Inter/Roboto/Arial, called out by name in Claude's
own design guidance as overused, generic choices.

**What the Verifier actually does** (`apps/web/app/verify/page.tsx`, `lib/chain.ts`,
`lib/replay.ts`): takes a `StewardAccount` address + RPC URL, reads its on-chain event history
directly via `viem` (`eth_getLogs` for `Decision`/`Graduated`/`Demoted`), and independently
replays every tier transition using `@steward/engine`'s actual `checkPromotion`/`recordExposure`/
`recordReceipt`/`graduate`/`applyIncident` functions — the same functions the three-way
differential suite already holds to account, not a reimplementation for the UI. Checks sequence
continuity and cross-checks the replayed final tier against the contract's own current
`tierState()`, and for every `Graduated` event, independently recomputes whether promotion was
actually eligible at that point rather than trusting the event. Confirmed live against Phase 4's
real demo data (`scripts/demo-driver.ts`'s Agent A, re-run fresh for this test): correct
account summary, all 12 events replayed in the right order, sequence continuity OK, replayed
final tier T1 agreeing with on-chain T1, and "Graduation T0 -> T1: independently confirmed
eligible."

**Real bug found and fixed via live testing, not just code review:** `reasonMask` is a
`uint32` in the ABI; viem decodes it as a plain JS `number`, not `bigint` (see
`docs/API_NOTES.md`'s new viem section for the full measured convention). A first draft cast
it to `bigint` and did bigint bitwise math — `TypeError: Cannot mix BigInt and other types` at
runtime. This is exactly the kind of bug a differential-tested backend can't catch (the engine
itself is correct; the bug was in how the UI's own on-chain-read layer fed it data) and exactly
why "start the dev server and use the feature" (this repo's own engineering rule for UI
changes) matters — a passing `pnpm build` (TypeScript compiles fine; the mismatch is a runtime
type, not a static one) would have shipped this. Found by actually calling the running page
against real fork data and reading the error it displayed, not by inspection.

**A red herring worth recording so it isn't treated as a real finding later:** while debugging
the above, an early symptom (zero events found, or a `DIVERGES` result) looked like it might
mean Anvil's `--dump-state`/`--load-state` doesn't preserve transaction/log history across a
fork restart, only EVM state. That hypothesis did not hold up: once the BigInt bug was fixed,
the exact same restarted-fork scenario worked correctly. The real cause of the confusing
intermediate results was the BigInt crash being silently swallowed by an earlier, less
careful attempt to grep raw RSC-stream HTML for expected substrings — the response was never
inspected in full at that point. Lesson applied here, not just noted: when a live UI test
result looks wrong, read the actual response before forming a hypothesis about the system
under test.

**Known limitation carried into this slice, not new:** the RPC flakiness documented throughout
Phase 3/4 (`docs/API_NOTES.md`, `docs/LIMITATIONS.md`) affects the Verifier too —
`eth_getLogs`/`eth_getTransactionReceipt` calls against the free public endpoint this fork
forks from intermittently return "archive requests require a personal token" even for recent,
locally-known data. The Verifier's error boundary displays this cleanly (a real RPC error, not
a crash), but does not retry — unlike `scripts/demo-driver.ts`'s `robustSend`/`withRetry`,
retry logic was not added to the read-only verifier path in this slice. Worth adding if this
becomes the primary demo surface for judges rather than a build-time verification tool.

**Still to build for Phase 5** (tracked in `docs/LIMITATIONS.md`): the full wallet-connected
live app (mandate builder, dashboard, decision feed, approvals inbox, attack lab), and the
honeypot (logging/leaderboard only per the zero-funds decision, no real payout).

## 2026-09-22 — Phase 5, second slice: Simulate, a no-wallet client-side scenario simulator

**What it is** (`apps/web/app/simulate/`, the `/simulate` route): per `serv PLAN_v2.md` §12.2,
"frozen canonical scenarios run live in the browser through the TypeScript engine... judges can
use this without a wallet or funds." Fully client-side (`"use client"`, no RPC, no server round
trip) — a tier selector, mandate sliders (`maxTxUsdc`, `maxBps`, `maxVaultUsdc`,
`minLiquidUsdc`, `approvalAbove`), a treasury/reserve/proposed-amount panel, a 3-state evidence
health selector mapped directly to `healthMultiplierBps` (0/5000/10000 per spec/evidence.md's
effect table), a separate evidence-freshness toggle (the distinct `STALE_EVIDENCE` bit), a
paused toggle, and a 7-preset attack lab. Every control change recomputes live via direct calls
into the real `computeCapacity`/`capMandate`/`capLiquid`/`checkDeposit` — the same functions the
differential suite already holds to account, not a UI-side reimplementation of the policy
logic. Nothing on this page invents a financial number.

**Client-bundling constraint, solved with deep imports:** `packages/engine/src/health.ts` and
`evidence.ts` both import `node:crypto`, which breaks in a browser bundle. The package's barrel
(`packages/engine/src/index.ts`) does `export * from "./health.ts"` / `"./evidence.ts"`, so any
import from `@steward/engine` (the barrel) evaluates those modules regardless of what's actually
used. Fixed by importing directly from the specific submodule files Simulate actually needs
(`packages/engine/src/{policy,accounting,tiers,types}.ts`), bypassing the barrel and
`node:crypto` entirely — viable because `packages/engine/package.json` has no `"exports"` field
restricting deep imports.

**A real unit-scale finding, caught before it became a bug in this page:** the engine's own
canonical unit is a small whole number — confirmed against `fixtures/differential/
deposit_cases.json` (`"amount": "100"`, `"treasury": "10000"`, `"maxVaultUsdc": "1200"`) and
`packages/engine/src/types.ts`'s own `TIER_SCHEDULE`/`HARD_CAP` (`120n`..`1200n`, not
`120n * 10n**18n`). The real, deployed contract scales the same constants by 1e18
(`contracts/src/libraries/Types.sol`: `TierLimits(120e18, 150e18, ...)`,
`HARD_CAP = 1200e18`). A first draft of this page multiplied every UI slider value by `10n **
18n` before feeding it to the engine (copying the "wei" convention from the rest of the repo),
which would have made `capTier` (native small scale, e.g. `150n`) always the binding, near-zero
constraint against every wei-scaled mandate/treasury value — every scenario would have shown
near-zero capacity regardless of slider position, a silently broken-looking demo. Caught by
reading `fixtures/differential`'s actual fixture values before wiring the sliders up, not by
running the page first. Fixed by dropping the ×1e18 conversion entirely — Simulate stays in the
engine's own native scale throughout, since it never talks to the chain and has no real wei
amount to reconcile against.

**This means `apps/web/lib/replay.ts` (the Verifier, previous slice) has the mismatch Simulate
avoided:** it feeds real on-chain wei amounts directly into `recordExposure`/`checkPromotion`
unscaled. This didn't produce a visibly wrong result in Phase 4/5 testing — `checkPromotion`'s
`minRiskUnits`/`peakRequiredBps` thresholds are tiny native-scale numbers that pass trivially no
matter how large the (wrongly-scaled) input is — but it means the Verifier's graduation checks
aren't exercising the real threshold math at the real scale. Recorded here rather than silently
patched into `replay.ts`, since that file is otherwise tested and confirmed working against real
data; fixing it is a separate, deliberate change, not a drive-by edit. Tracked in
`docs/LIMITATIONS.md`.

**Attack lab correctness note:** an early draft's first preset ("over tier's maxTx") was itself
wrong — `checkDeposit` only checks `mandate.maxTxUsdc` for the `OVER_MAX_TX` reason bit; the
tier's own `maxTx` field isn't read by this function at all (only `capTier` = tier's `maxVault`
feeds into `computeCapacity`, producing `OVER_CAPACITY` if exceeded, not `OVER_MAX_TX`). Caught
by tracing the preset against `policy.ts`'s actual source before shipping it, not after — the
preset was split into two honest ones ("Over mandate's maxTx" and "Over tier's capacity"), each
naming the specific reason bit it actually triggers. All seven presets were hand-traced against
`checkDeposit`'s real logic and confirmed to produce exactly their claimed verdict/reasons.
Presets are also defined relative to a fixed `DEFAULT_STATE`, not the current on-screen state,
so clicking them in any order reproduces the same result deterministically.

**Verified:** `pnpm lint`/`pnpm typecheck`/`pnpm test`/`pnpm build` at root, and `pnpm --filter
web run lint`/`build` (which also runs Next's own TypeScript check) — all clean. The
server-rendered initial page state was fetched directly (`curl`) and its computed values
(capacity 400, headroom 400, binding term `capTier`, verdict `ALLOW`) matched a hand-computation
of the same `computeCapacity`/`checkDeposit` call exactly.

**Update, same session — the Chrome-extension gap was closed with Playwright instead:**
`@playwright/test` was added to `apps/web`, Chromium installed locally
(`npx playwright install chromium`), and `apps/web/e2e/simulate.spec.ts` written: 4 tests
that drive a real headless browser — drag the proposed-deposit slider to its min/max and
check the verdict/reason changes both directions, click the tier selector (T0/T3) and check
the displayed tier ceiling, and click through all 7 attack-lab presets checking the exact
reason bit each one claims. All 4 pass against both `pnpm dev` and a real `next build` +
`next start` production build.

Two real bugs were caught by this, not by inspection:
1. A first draft located attack-lab buttons by `getByRole("button", { name: /regex/ })`
   against each preset's title. This is ambiguous — "Over mandate's maxTx"'s own description
   text quotes "Over tier's capacity" by name (a cross-reference added for the reader), so a
   name-regex match against the whole button (title + description) hit two buttons at once.
   Fixed by matching the exact title text node and walking up to its containing `<button>`
   instead of matching against the full accessible name.
2. `nohup pnpm run start -- --port 3100 &` (the first draft of the CI "start the built app"
   step) silently fails: pnpm forwards the literal `"--"` token itself through to `next
   start`, and Next's CLI treats it as a project-directory positional argument, not an
   argument separator — `Invalid project directory provided, no such directory: .../--port`.
   Caught by running the exact CI command locally before trusting it in the workflow, not by
   assuming pnpm's passthrough behaves like a normal CLI's `--`. Fixed to `next start -p
   3100` directly, which has no such ambiguity.

First wired into CI as hand-rolled steps: install Chromium, `nohup npx next start -p 3100 &`,
poll `/simulate` with a bash curl loop (up to 45s), then run the suite. This was sent through
this repo's `dx-auditor` review gate (CLAUDE.md: CI/repo-structure changes require it) and
came back **PASS**, with one real, non-blocking finding: backgrounding a server across
separate GitHub Actions `run:` steps with a bare `&` works on `ubuntu-latest` (confirmed —
nothing reaps a step's orphaned children when the step's own script exits) but isn't a
documented contract, and the "start" step itself always reports success trivially regardless
of whether `next start` actually launched, so a crash is only ever caught by the wait loop's
timeout. The auditor's recommended fix was adopted before calling this done: Playwright's own
`webServer` option (`apps/web/playwright.config.ts`), active only when `process.env.CI` is
set — `command: "npx next start -p 3100"`, polls `url` until it answers, tears the server
down after the run automatically. This replaced the two hand-rolled CI steps entirely; local
usage (`BASE_URL` pointed at whatever dev/fork server is already up, per this repo's usual
long-lived-background-process pattern) is untouched, since `webServer` is `undefined` outside
CI. Re-verified locally by setting `CI=true` and confirming Playwright started `next start`
itself, ran all 4 tests, and tore the server down afterward (port confirmed free
post-run) — then re-verified the local `BASE_URL` path still works unchanged.

`/verify` is not covered by CI — it needs a live fork with real demo state, which a cold CI
runner doesn't have; it stays a manual gate (`make verify-live` / `pnpm dev` + click-through),
documented as such rather than silently skipped.

## 2026-09-22 — Phase 5, third slice: the live app's first piece — dashboard + controls

**Scope decision, stated up front:** `serv PLAN_v2.md` §12.3 bundles a lot into "the live
app" — mandate builder, dashboard, decision feed, approvals inbox, attack lab, controls. That
is too much to build and actually verify in one pass. Followed this repo's own established
pattern (Verifier, then Simulate, each a separate verified slice): built and verified the
dashboard, capacity gauge, decision feed, and the three simplest real controls (pause,
unpause, veto) first. Mandate builder, approvals inbox, attack lab, emergency exit, and the
agent-side loosen flow are explicitly deferred — see `docs/LIMITATIONS.md`'s updated §12.3
entry for exactly what and why.

**What it is** (`apps/web/app/app/`, the `/app` route): a Server Component dashboard
(`page.tsx`, same GET-param pattern as the Verifier — address + RPC in the URL, no client JS
needed to load it) showing real on-chain reads (liquid/exposure/treasury, full mandate and
envelope, pending-loosen state, tier) plus a capacity gauge computed the same way Simulate
computes one — deep-imported `computeCapacity`/`capMandate`/`capLiquid` from
`packages/engine/src/accounting.ts`, never a UI-side reimplementation — and a decision feed
(real `Decision`/`Graduated`/`Demoted` history, newest first). A client island
(`Controls.tsx`) adds a minimal wallet connection (`apps/web/lib/wallet.ts` —
`viem`'s `createWalletClient(custom(window.ethereum))` directly, not wagmi/RainbowKit;
CLAUDE.md's rule against unrequested abstractions applies here as much as anywhere) and
role-gated buttons for `pause`/`unpause`/`cancelLoosen` (veto), each re-reading `nextSeq`
immediately before submitting rather than trusting the page's own SSR'd (possibly stale)
state.

**The testing problem this slice actually had to solve:** unlike Simulate (no wallet, no
chain), this page needs a real signed transaction to test at all — and the persistent BSC
fork from Phase 4 turned out to be unusable for new work: `forge script` against it now fails
with `state at block #123384051 is pruned` — the public RPC this fork forked from no longer
serves that historical block's state for addresses it hasn't already cached. This is the same
class of RPC flakiness documented throughout Phase 3/4 (`docs/API_NOTES.md`), just a harder
failure mode (permanently pruned, not intermittent) than seen before. Rather than spend the
time re-pinning and redoing Phase 4's whale-funding pipeline just to get test data, wrote
`contracts/script/DeployLocalMock.s.sol` — a throwaway, explicitly-not-part-of-any-`make`-
target script that deploys the exact same contract stack against a plain, non-forked local
Anvil using this repo's own `test/mocks/MockERC20`/`MockManagedVault` (already used by 25 of
the 60 passing unit/invariant tests). Zero BSC dependency, zero archive-access risk, same
real contracts, same real ABI.

Deployed it, drove one real agent deposit via `cast` (had to shrink the amount from an
initial 500e18 attempt to 100e18 after hitting a real `OverMaxTx` revert — T0's tier
`maxTx` is 120e18, a useful reminder that the tier ceiling, not just the mandate, is a real
constraint even during manual test setup), then confirmed via `curl` against the real
deployed account that the dashboard and capacity gauge matched a hand computation exactly:
capacity 150, headroom 50, binding term `capTier` (T0's real `maxVault`, 150), capMandate
1,200, capLiquid 10,000, capacityCapOnChain 1,200 — all real reads, not fixtures.

**Real, generalizable unit-scale finding, caught before it became a live-app bug:** the same
gap already found and documented for `apps/web/lib/replay.ts` (small-whole-number
`TIER_SCHEDULE` in `packages/engine/src/types.ts` vs. wei-scaled `TierLimits` in
`contracts/src/libraries/Types.sol`) applies here too, but in the *opposite* direction from
Simulate's fix: because the live app reads real wei-scale amounts off the chain, `capTier`
has to be scaled *up* (`× 10n ** 18n`) to compare correctly against them —
`apps/web/lib/live-capacity.ts` does this and documents why in its own header comment, right
next to the confirmed-correct real numbers above. Simulate's fix (stay unscaled) and this
fix (scale up) are opposite corrections to the same underlying gap, which only makes sense
once you know which side of the wei boundary each piece of code is actually operating on —
recorded here so the distinction doesn't have to be rediscovered by the next piece of code
that touches both the engine and a live chain read.

**A real, signed-transaction Playwright test, not a stub — and a second bug it caught:**
`apps/web/e2e/app-controls.spec.ts` injects a mock `window.ethereum` via
`page.addInitScript`, whose `eth_sendTransaction` handler round-trips through
`page.exposeFunction` to a real Node-side `viem` `WalletClient` holding Anvil's well-known
dev-account-1 private key (copied from a live `anvil` startup log, not hand-transcribed —
same discipline as Phase 4). Clicking "Connect wallet" then "Pause" in the actual rendered
page produces a real signed transaction, broadcast to the real local Anvil, confirmed via
`waitForTransactionReceipt`, after which the page reloads and the dashboard shows PAUSED.
Unpause restores state for repeatability. This is the same category of technique as
Simulate's slider/button e2e tests — a real browser, real DOM, real recompute — extended one
step further to a signed on-chain write, entirely without a real MetaMask or the (still
unconnected) Claude in Chrome extension.

First draft of this test asserted `getByText("OWNER", { exact: true })` and failed with
"element(s) not found" even though the page visibly showed a badge reading "OWNER" on
screen. Cause: `Controls.tsx`'s role badge renders the literal string `"owner"` (lowercase)
with a CSS `uppercase` class for display — `text-transform` is purely visual and never
changes the actual DOM text node, so `getByText` (and a screen reader) sees `"owner"`, not
`"OWNER"`. Fixed by asserting the real DOM text. Recorded here because it's a general lesson
about this whole design system (every badge in this repo uses the same CSS-uppercase-on-
lowercase-text pattern — `VerdictBadge` in the Verifier and Simulate too), not specific to
this one test.

**Also confirmed, not assumed:** `Controls.tsx`'s client-side `readNextSeq`/
`waitForTransactionReceipt` calls go straight from the browser to the RPC over plain HTTP —
a real CORS exposure if the target RPC didn't send permissive CORS headers, since the app is
served from a different origin/port than the RPC. The passing e2e test confirms Anvil's
default CORS behavior is permissive enough for this to work as-is; not verified against every
possible RPC provider, so a future non-Anvil RPC target (a hosted BSC RPC, say) would need
this checked again before shipping — noted here rather than assumed to generalize.

**Not run in CI:** `app-controls.spec.ts` needs a freshly deployed local Anvil per run (not
just a static built app like `simulate.spec.ts`), so it stays a manual verification step for
now, same category as `make verify-live`.

**Sent through `reliability-auditor` (CLAUDE.md's gate for error-handling/retry changes) —
PASS with findings, all fixed before calling this slice done:**

1. **Real bug, fixed:** `waitForTransactionReceipt` resolves on any *mined* receipt,
   regardless of `status` — it does not throw on a revert, only on timeout/replacement
   (confirmed by reading viem's own source). The first draft of `Controls.tsx`'s `runWrite`
   awaited it and then unconditionally reloaded the page, so a reverted `pause`/`unpause`/
   `cancelLoosen` (e.g. losing a `BadSequence` race) would have silently looked like success,
   with no error ever shown — a real regression against this repo's own established
   discipline (`scripts/demo-driver.ts`'s `robustSend` explicitly checks `status === "0x1"`).
   Fixed by checking `receipt.status === "reverted"` and throwing before the reload.
   Regression-tested, not just fixed: `app-controls.spec.ts` gained a second test that forces
   a real `BadSequence` race (delays the mock wallet's actual broadcast, wins the race with a
   genuine out-of-band `pause()` call consuming the same seq first, confirmed via `cast`-style
   direct `viem` calls) and asserts the UI shows an error rather than silently reloading — per
   CLAUDE.md's "a guard ships with a test that fails if the guard is deleted." In practice,
   this specific race is usually caught even earlier, at `writeContract`'s own pre-flight
   gas-estimation/simulation step (viem rejects it before ever broadcasting) — confirmed live,
   both paths land in the same `catch` block, and the test accepts either, since the real
   invariant is "an error is shown, nothing reloads," not which layer catches it.
2. **Comment softened:** `Controls.tsx`'s header comment originally asserted, as a flat
   guarantee, that "the model never has a code path into this component... nothing here is
   reachable from an LLM's output." True today (confirmed: nothing outside this component's
   own `onClick` handlers imports `lib/wallet.ts`), but nothing *enforces* it — a future
   change wiring a server action into `runWrite`'s logic would make it false silently. Matches
   this repo's own recorded lesson (`memory/feedback_no_stale_comment_claims.md`: don't write
   comments asserting guard behavior a later refactor can invalidate). Reworded to state it as
   a currently-true fact to re-check on review, not a self-enforcing guarantee.
3. **Documented, not fixed (no current downstream risk):** manual UI-triggered actions log a
   zero `receiptHash`, so two different manual actions can share the same one — the real
   per-account uniqueness key is `(actor, seq)`. No consumer in this repo currently keys off
   `receiptHash` alone, so this is a dormant risk for a future indexer, not an active bug.
   Recorded in `docs/API_NOTES.md` so the next person building one doesn't rediscover it the
   hard way.

The auditor also confirmed, by tracing the actual import graph rather than trusting the
comment, that the core invariant does hold: every write in this slice originates from a human
`onClick` after an explicit wallet-signature prompt, with no code path an LLM's output could
reach.

## 2026-09-23 — Phase 5, fourth slice: the rest of the live app's controls

**Scope:** finished what the third slice deferred — `tightenCap`/`raiseReserve`, the
agent-side loosen flow (`proposeLoosenCap`/`applyLoosen`), a `graduate()` trigger with a live
eligibility hint, emergency exit (`requestRedeem`), the mandate builder (`setMandate` with a
plain-language preview), and a resolution for "approvals inbox." With this slice, every
control `serv PLAN_v2.md` §12.3 lists is built; only the honeypot remains for Phase 5.

**"Approvals inbox" — checked against the real contract before building anything, not
assumed:** grepped `contracts/src/` for `approvalAbove` — it appears only as a `Mandate`
struct field (`Types.sol`), never read by `deposit()` or any other function. The off-chain
`@steward/engine`'s `NEEDS_APPROVAL` verdict has no on-chain counterpart at all: deposits are
agent-immediate, full stop. An "approvals inbox" as a live, actionable queue would have to be
invented from nothing — dishonest to build as if it were real. What got built instead
(`apps/web/app/app/AttackLab.tsx`): a read-only pre-flight preview through the real policy
engine against the account's real live state, answering "would this cross the approval
threshold or get refused" before anything is submitted. This also satisfies the plan's
separately-listed "attack lab" — same preset-driven UI as Simulate's, pointed at real numbers.

**Live graduation eligibility, not a guess:** `apps/web/lib/live-graduation.ts` deep-imports
the exact `checkPromotion` function the Verifier already uses and the contract implements
on-chain, fed the account's real current `tierState`. The `Graduate` button is disabled with
the actual failed-condition list shown (`"Graduation blocked on: minDwell, minReceipts"`)
rather than either always being clickable (inviting a doomed, gas-wasting transaction) or
guessing at eligibility from a UI-side heuristic.

**Real bug #1 — two "Connect wallet" buttons:** `Controls.tsx` and the new
`MandateBuilder.tsx` were each written with their own independent wallet-connection state (a
straightforward copy of the pattern from the third slice). Once both rendered on the same
page, this produced two separate, independent "Connect wallet" buttons — a real UX defect
(which one do you click? do you have to click both?), and it broke e2e locator uniqueness the
moment a test tried `page.getByRole("button", {name: "Connect wallet"})` with both mounted.
Fixed properly, not patched around in the test: extracted `apps/web/app/app/
WalletSection.tsx`, which owns the connection exactly once and passes the connected
`ConnectedWallet` down to both `Controls` and `MandateBuilder` as a prop — they no longer
manage their own connection state at all. `AttackLab` needs no wallet and was left standalone.

**Real bug #2 — new events silently mislabeled:** widening `stewardAccountAbi` to include
`LoosenProposed`/`LoosenCancelled`/`LoosenApplied` (needed so the decision feed shows the new
loosen flow) exposed that `page.tsx`'s event-to-row mapper matched `"Decision"` and
`"Graduated"` by name and treated *everything else* as `"Demoted"` — a fallback that was
correct back when Demoted was genuinely the only other event kind, and silently wrong the
moment a third kind existed. Fixed with real per-kind handling for all three new events before
any UI code shipped showing a loosen proposal mislabeled as a tier demotion.

**Verified against the real contract before trusting any UI code, one function at a time:**
every new write's exact ABI encoding was confirmed via direct `cast` calls against a fresh
`contracts/script/DeployLocalMock.s.sol` deployment before `Controls.tsx`/`MandateBuilder.tsx`
were trusted to encode it the same way:
- `tightenCap`/`raiseReserve`: succeeded.
- `proposeLoosenCap`: succeeded; `applyLoosen` correctly reverted `LoosenDelayNotElapsed`
  before the window, then succeeded after `evm_increaseTime` — capacityCap read back as
  exactly the proposed value afterward.
- `graduate()`: correctly reverted `NotEligibleForGraduation` at T0 with only 2 receipts
  (real minReceipts=10 requirement) — matching `checkLiveGraduation`'s own independent
  recomputation exactly, including *why* (both agree the blocking condition is `minReceipts`,
  not dwell/risk/peak, which — consistent with the already-documented wei-scale finding — pass
  trivially regardless of the TIER_SCHEDULE scale question, since they're wei-scale-dwarfed
  either way; `minReceipts` is a plain integer count, unaffected by that whole question).
- `setMandate`: succeeded; read back matching the submitted tuple exactly.
- `requestRedeem`: needed a real deposit first (to have real shares to redeem) — succeeded
  once shares existed.

**Two dedicated Playwright tests, both real signed transactions through the actual rendered
UI, not stubs:** `apps/web/e2e/mandate-builder.spec.ts` (edit a field, click Preview, confirm
the diff text reads `"maxTxUsdc: 1,000 units → 1,111 units (looser)"`, click Confirm & sign,
confirm the *dashboard's* own display — a separate component reading fresh state after
reload — shows the new value) and a refactored `app-controls.spec.ts` (now importing a shared
`apps/web/e2e/mock-wallet.ts` instead of a duplicated local copy of the same mock, after this
slice needed a second file to use the identical mocking pattern).

**Test bug caught by actually running it, not by inspection:** a first draft of the mandate
builder test asserted the diff text was visible *before* clicking "Preview N changes" — but
`MandateBuilder.tsx`'s diff `<ul>` only renders once `confirming` is true, which happens
*after* that click (the button's own label already reflects the change count beforehand, but
the diff text itself doesn't). Fixed by moving the assertion after the click.

**A real cross-file test-isolation finding:** running `app-controls.spec.ts` and
`mandate-builder.spec.ts` together with Playwright's default worker parallelism put them in
separate workers racing real transactions against the same shared local-mock account — each
file serializes its own tests internally, but nothing serializes *across* files. Didn't cause
a failure this run (the one failure that occurred was the assertion-order bug above, confirmed
by rerunning with `--workers=1` and getting a clean pass both before and after), but it's a
real, documented risk for next time: run multiple `/app` e2e files together with
`--workers=1`, noted in `mock-wallet.ts`'s own header comment so it isn't rediscovered by
chasing a flaky failure later.

**Not run in CI**, same reasons and same category as the third slice's tests: both need a
freshly deployed local Anvil per run.

**Reliability-auditor review not completed for this slice — stated plainly, not implied
otherwise.** Per CLAUDE.md's review gate, a `reliability-auditor` pass was launched against
this slice's six new write actions and `MandateBuilder.tsx`'s separately hand-written
`confirmAndSign`. The user asked to stop waiting on it mid-run before it produced a report, so
**this slice has not been through that formal gate** — unlike the third slice, which did
(PASS with the `receipt.status` fix). Two of the specific things that review was checking were
verified directly afterward, by hand, so they're not left as open unknowns:
- `MandateBuilder.tsx`'s `confirmAndSign` (lines ~110-113) **does** include the same
  `receipt.status === "reverted"` check `Controls.tsx`'s `runWrite` has — confirmed by reading
  the current file, not assumed from having written it that way originally.
- Every new write's UI role-gate was checked against the contract's actual modifier
  (`contracts/src/StewardAccount.sol`): `tightenCap`/`raiseReserve` (`onlyOwnerAgentOrGuardian`
  → gated on owner/agent/guardian, `Controls.tsx:173`), `proposeLoosenCap` (`onlyAgent` →
  agent-only, `:218`), `requestRedeem` (`onlyAgentOrGuardian` → agent/guardian,
  `:243`), `applyLoosen` (no modifier at all, truly anyone → correctly ungated in the UI too,
  `:158`), `graduate()` (no modifier, anyone → UI restricts to owner/agent/guardian, a
  conservative subset of what the contract actually allows, not a bug). All confirmed
  correct.
**The other question was checked and turned up a real bug, now fixed:** `confirmAndSign`
carried the four non-editable `Mandate` fields (`issuerHaircutBps`,
`latencyHaircutBpsPerDay`, `latencyHaircutMaxBps`, `leadFloorDays`) straight from the page's
SSR'd `state` prop — captured at page load, potentially minutes stale by the time a user
finishes filling in the form and clicks "Confirm & sign." Since `setMandate` overwrites the
entire struct, any legitimate concurrent change to one of those four fields in that window
would have been silently clobbered back to its old value — a real TOCTOU gap, the same class
of bug `runWrite`'s fresh `nextSeq` re-read already guards against for `seq`, just not yet
applied here. Fixed: added `apps/web/lib/chain.ts`'s `readMandateCarryThroughFields`, called
immediately before constructing the write in `confirmAndSign`, so those four fields are read
fresh at submit time, not at page-load time. Re-verified against a real local deployment
(`mandate-builder.spec.ts` still passes) after the fix.

What's still genuinely open, not verified: the `toWei()` error path's interaction with
`busy`/`actionError` state consistency across a rapid sequence of actions in `Controls.tsx`.
Re-run the full `reliability-auditor` pass before treating this slice as reviewed to the same
bar as the third slice's.

## 2026-09-23 — Phase 5 wrap-up: re-verifying against real data surfaced Phase 4 had gone stale

**Context:** asked to continue with what's left in Phase 5. Per `serv PLAN_v3.md` §12, Phase
5's own exit criterion is "a non-technical person completes the demo script with and without
a wallet" — not a new feature, a walkthrough. Started by actually trying to walk the Verifier
against Agent A's real Phase 4 data (the core "without a wallet" leg of the demo script) to
confirm it still works, rather than assuming `LIVE.md`'s existing writeup was still current.
It wasn't.

**Found: Phase 4's original demo data no longer exists anywhere reachable.** The persistent
fork process (`scripts/fork-node.sh`) was still running (same PID this whole session per
earlier notes), but `LIVE.md`'s own cited tx hash
(`0x6807e5a8f29019cb849a1c64a2a664621e0010e2b060d8cdb99296bcac1022a9`) no longer resolved on
it (`cast tx: tx not found`), and the pinned block it was forked from (123384051) now fails
`forge script` with `state ... is pruned` — the same archive-pruning symptom found earlier
this session when trying to deploy the honeypot's local-mock stack, but this time affecting
the *original* Phase 4 fork's own pinned block, not a new attempt. **This is a new, harder
finding than the archive-flakiness already documented:** the upstream free RPC's archive
window doesn't just intermittently 403 — it genuinely ages a pinned block out over time, even
one that worked perfectly when first pinned less than 24 hours earlier. "Reproducible via
fork state" has a real, previously-undocumented expiration date attached to it.

**Fixed by treating it as what it is — not a data-recovery problem, a re-run:** killed the
stale fork process (confirmed dead first via `netstat`/`curl`, not assumed), started a fresh
one (`scripts/fork-node.sh --fresh`, which re-pins to the *current* block), and ran the full
Phase 4 pipeline again: `DeployDemo.s.sol`, fund Agent A, `demo-driver.ts`,
`replay-fork-demo.ts`. Confirmed working end to end on the first fresh-block attempt (the
original pinned block's failure was specific to that aged-out block, not a general RPC outage
— the fresh block deployed and drove successfully, modulo the usual transient 403 noise).

**Two real bugs in `scripts/demo-driver.ts` caught by actually re-running it, not by
inspection:**
1. Agent A's funding was a manual, *undocumented* step. `LIVE.md`'s own reproduction
   instructions said to fund Agent A per "`scripts/demo-driver.ts`'s header for the exact
   `cast` commands" — that header contains no such commands and never did. Only surfaced by
   trying to reproduce from scratch and hitting a real `OverCapacity` revert on an unfunded
   account, since the original 2026-09-22 session's funding step apparently happened by hand,
   off-script, and was never captured anywhere durable. Fixed: `main()` now calls
   `fundFromWhale(addr.accountA, ...)` itself, mirroring the funding it already does for
   Agent B — the whole pipeline is genuinely single-command reproducible now, not
   partially-documented.
2. This specific re-run's RPC was flaky enough that **every single transaction** took
   `robustSend`'s "recovered" path (the probe confirms it landed, but `cast send` itself never
   returned a hash) — worse than the original run, which had some clean successes. The
   recovery path recorded `hash: null` permanently in that case, which would have meant
   `.demo-state/receipts.json` — and `LIVE.md`, and the Verifier demo — had *zero* citable tx
   hashes despite every action being real and independently re-verified. Fixed: added
   `findRecentTxTo(to)`, which looks up the actual hash from the newly-mined block after a
   recovery (Anvil mines exactly one block per tx here, confirmed by the receipts' own
   block-number sequence) — a best-effort lookup that returns `null` rather than guessing if
   the block doesn't contain exactly one matching transaction. Re-ran after the fix: all 13 tx
   hashes correctly recovered this time, confirmed resolving via `replay-fork-demo.ts`.

**Verified end to end with the fresh data, not just claimed:** `replay-fork-demo.ts` confirmed
all 13 tx hashes resolve with `status=0x1`, and independently recomputed `eligible=true` for
the T0→T1 graduation from the real on-chain `TierState`. Then confirmed the **UI** side too —
`/verify?address=<Agent A>&rpc=http://127.0.0.1:8546&fromBlock=123520781` renders "Sequence
continuity: OK", "Match: AGREES", and "Graduation T0 → T1: Independently confirmed eligible"
against the fresh data, live, via `curl`. (A first test of this omitted `fromBlock`, which
defaults to genesis and — predictably, per the Verifier's own already-documented limit —
needs archive access and fails; not a new bug, a testing mistake, caught and corrected before
being reported as a finding.) `LIVE.md` rewritten with the fresh addresses, tx hashes, block
numbers, and an honest new section explaining the pinned-block-ages-out finding and both
driver fixes, so the next person to hit `state ... is pruned` on this specific pinned block
doesn't have to re-derive what happened.

**Attempted and explicitly not resolved: persisting the fresh fork's state to disk** via
`anvil_dumpState` (RPC) written directly to `.fork-state/anvil-demo-state.json`. Failed —
`--load-state` rejected the hand-written file (`invalid type: integer 0, expected struct
SerializableState`), meaning the RPC method's hex-string return value and the CLI flag's
on-disk file format are not simply interchangeable the way this assumed. Not chased further
this session (see `LIVE.md`'s own note); the reliable path remains `fork-node.sh`'s own
`--dump-state` writing on a clean shutdown of a process it started itself.

**Net assessment of Phase 5's exit criterion:** every individual piece — Verifier, Simulate,
the live app (dashboard, capacity gauge, decision feed, every control, mandate builder,
attack lab), and the honeypot — is now confirmed working against real data, including the
core Phase 4 "same request, two agents" story the demo script's centerpiece depends on. What
hasn't happened is literally handing this to a non-technical person and watching them
complete it unassisted — that's a real, stated gap, not implied to be done. `docs/
LIMITATIONS.md` updated accordingly.

## 2026-09-23 — Phase 5 exit gate, second pass: is the gate itself built?

**The question asked, directly:** having confirmed every piece works, is there an actual
artifact — a document or page — that a non-technical person could pick up and follow, or does
"the demo script" only exist as `serv PLAN_v3.md` §13.1's text? Checked honestly: no such
artifact existed. §13.1 is written as a *video-recording cue sheet* for whoever records the
submission ("0:35 Agent B... reverts on BscScan" — timestamps for a narrator, not
click-through instructions for a viewer), and it references BscScan, which this fork-only
build never touches. Nothing in the repo handed a person real, working links to click through
themselves.

**Built:** `apps/web/app/demo/page.tsx`, the `/demo` route — six numbered, plain-language
steps (stranger rejected → earned agent succeeds → verify it yourself → try it with no wallet
→ connect a wallet and act on the real account → try to break it), each linking to the real
`/verify`, `/simulate`, `/app`, `/honeypot` pages with **real, live-read query parameters**,
not hardcoded ones.

**Deliberately not hardcoded, for a reason already learned the hard way this session:** a
first instinct would be to bake Agent A/B's addresses and the pinned block directly into the
page, the same way `LIVE.md` originally did — and that's exactly the mistake this session
spent the previous entry fixing (a hardcoded address/block going stale the moment the fork's
pinned block ages out). Instead, `/demo` reads `contracts/.fork-state/deployed-addresses.json`
and `.demo-state/receipts.json` at request time and builds its links from whatever is
*currently* deployed — reproducing the demo pipeline fresh keeps this page accurate without
touching its source. If neither file exists yet, the page shows the exact three-command setup
sequence instead of a broken or stale walkthrough.

**A real bug caught by reading `next build`'s own output, not by inspection:** `/demo` has no
`searchParams`, no `cookies()`/`headers()` call — nothing in Next's static/dynamic analysis
recognizes plain `node:fs` reads as depending on runtime state. First build listed it as `○
(Static)`, meaning Next would have prerendered it once and served that one build-time snapshot
of `.demo-state/receipts.json` to every visitor forever — silently reintroducing the exact
staleness bug the previous entry just spent real effort fixing, in the one page whose entire
purpose is reading that file fresh. Caught by actually reading the build's route table, not
assumed correct. Fixed: `export const dynamic = "force-dynamic"`, confirmed by rebuilding and
seeing `/demo` listed as `ƒ (Dynamic)`.

**Verified against the real, live fork, through the actual rendered UI:** fetched `/demo`
live and confirmed it read the real current addresses and built the correct encoded links;
followed the Verifier link it generated and got "Sequence continuity: OK" / "Match: AGREES" /
"Independently confirmed eligible"; followed the honeypot link and confirmed the leaderboard
showed the real count (Category C = 11, matching the real driver run's 1 deposit + 9 receipts
+ 1 contrast deposit exactly). Wrote `apps/web/e2e/demo-walkthrough.spec.ts` (3 tests: renders
correctly regardless of data presence; the Verifier link leads to a real independently-
confirmed graduation; the honeypot link shows real counts) — all 3 pass against the live fork.
Manual-only (same category as `app-controls.spec.ts`), skips cleanly on a cold CI runner with
no local demo state, confirmed by running the full suite in `CI=true` mode.

**Net assessment, updated:** the exit *gate itself* — the artifact a non-technical person
would actually use — is now built and verified working end to end. What remains the same
real, stated gap as before: nobody who isn't already familiar with this repo has actually
picked it up and completed it unassisted.

## 2026-09-23 — Phase 6, first item: the fee-on-yield module

**Scope decision:** Phase 6 (`serv PLAN_v3.md` §12) is "reach (independent)" — six unrelated
items (ERC-8004 bridge, fee-on-yield module, x402-priced verification, multi-vault, Finance
District adapter, Halmos on `PolicyMath`), explicitly the first thing this plan says to cut.
Picked the fee-on-yield module first because it's the only one with a complete, already-
written spec (`serv PLAN_v2.md` §7.6, written in Phase 1, deferred to Phase 6 by the Phase 2
cut) rather than needing new research (ERC-8004 registry addresses on BSC are explicitly
unverified — `docs/LIMITATIONS.md`'s "ERC-8004 registry (G2)" — and Finance District/x402 both
need external API research this session didn't do).

**Design decision, made explicitly rather than defaulted into:** `packages/engine`'s
off-chain `Mandate` type (TypeScript and Python) already declares `feeBps`, `maxFeeBps`, and
`operator` fields — spec'd in Phase 1, never wired to an on-chain counterpart. The obvious
instinct is to add the matching fields to the on-chain `Types.Mandate` struct too. Checked
what that would actually cost first: `grep`ing for every `createAccount`/`new StewardAccount`
call site found 8 of them (`contracts/test/fork/ModeA.t.sol`,
`contracts/test/invariant/StewardAccountInvariants.t.sol`,
`contracts/test/unit/StewardAccount.t.sol` ×2, `contracts/test/unit/StewardFactory.t.sol`
×4, `contracts/script/DeployDemo.s.sol`, `contracts/script/DeployLocalMock.s.sol`), plus
`scripts/demo-driver.ts`'s raw `createAccount` ABI signature string, plus every place in
`apps/web` (`lib/steward-abi.ts`, `lib/chain.ts`, `MandateBuilder.tsx`) that already encodes/
decodes the exact 12-field `Mandate` tuple this session spent real effort building and
testing. Changing the struct's shape would have broken all of it for a feature this plan
itself marks lowest-priority. Chose instead: `feeBps`/`maxFeeBps`/`operator` live as
standalone `StewardAccount` state, owner-settable post-deployment (`setOperator`/
`setFeeBps`), not constructor params — joining the same "owner has unilateral power over
economic terms" category `setMandate`/`setCap`/`setCapCeiling`/`setReserve` already occupy,
rather than becoming a new, differently-gated concept. Zero ripple to anything already built.
This leaves a known, stated divergence: the off-chain `Mandate` type's fee fields are now
provably unused by any code path — recorded in `docs/LIMITATIONS.md` so it reads as a
documented choice, not a bug waiting to be rediscovered.

**A real gap in the test mocks, found before any contract code was written:**
`test/mocks/MockManagedVault.sol` was permanently pinned at 1:1 NAV ("1:1 NAV in this mock"
comments throughout, `finalizeRedeem` paying out `r.shares` directly with no price
adjustment). A fee-*on-yield* module is structurally untestable without a way to produce an
actual gain — checked this before writing a single line of `StewardAccount.sol`, not
discovered later via a failing test. Extended the mock with a real, test-adjustable
`navPerShare`, locked into each redemption request via the (previously hardcoded) real
`priceAtRequest` field the real vault's own interface already has, and paid out accordingly
at finalize — confirmed all 60 pre-existing tests still pass unchanged (they never touch
`navPerShare`, so it stays at the same 1:1 default they always implicitly assumed).

**TDD, per CLAUDE.md's own rule — a failing test written and confirmed failing before any
implementation:** `contracts/test/unit/FeeOnYield.t.sol` written first; confirmed it didn't
even compile (`Member "FeeAboveMax" not found`) against the pre-implementation contract,
before writing `StewardAccount.sol`'s actual changes.

**A real bug caught by taking a compiler warning seriously instead of suppressing it:**
`forge build` flagged an `unsafe-typecast` warning on the fee calculation
(`uint128(gain * feeBps / 10000)`). The reflex is to add a `forge-lint: disable-next-line`
with a one-line justification (the established pattern everywhere else in this file) — doing
that here required actually proving the cast was safe, which required proving `feeBps` can
never exceed 10,000 (100%). It could: `setFeeBps` only checked `newFeeBps <= newMaxFeeBps`,
never that either was `<= 10_000`. Since `claimFees()` sweeps the account's general USDC
balance (no separate yield-only bucket — this contract holds one pool of USDC, not two), a
`feeBps` above 100% would let `fee = gain * feeBps / 10_000` exceed `gain` itself, which
would make `accruedFees` (and therefore `claimFees()`) draw from principal, not yield — the
exact thing O-09 ("no path to principal") exists to prevent. Fixed by bounding
`newMaxFeeBps <= PolicyMath.BPS` in `setFeeBps`, found by trying to honestly justify a lint
suppression rather than by a test — no test in this session's first draft would have caught
a feeBps-above-100% misconfiguration, since none of the hand-written unit tests happened to
try one.

**Consulted the `onchain-access-control` skill — late, not before writing the code, and
that's stated plainly, not glossed over.** `CLAUDE.md` requires consulting it before writing
access-control/fund-movement logic; this session wrote `StewardAccount.sol`'s fee changes
first and only ran the skill afterward, while double-checking the work before calling it
done. Running it retroactively still found a real, actionable gap (its check 2, "guard the
read-then-settle gap"): `reconcileRedemption` read the *live* `feeBps` at reconcile time —
between `requestRedeem` and `reconcileRedemption` (real elapsed time; the real vault's
finalize is an external, asynchronous, operator-driven step) an owner could change fee terms
and have that change retroactively apply to a redemption an agent already decided to make
under the old terms. Fixed by snapshotting `feeBps` into a new `feeBpsAtRequest[requestId]`
mapping at request time (the same pattern `basisOutAtRequest`/`exposureAtRequest` already
established), read from the snapshot at reconcile, not live. Regression-tested with two
dedicated unit tests proving the snapshot holds in both directions — a rate raised after the
request doesn't retroactively apply, and neither does a rate lowered after the request (the
snapshot isn't a one-sided "protect against increases" check; it's symmetric).

**Real, fuzzer-driven O-09 invariant coverage added, not just the unit tests above:**
`contracts/test/invariant/StewardAccountInvariants.t.sol`'s `Handler` gained
`depositRedeemAndReconcileWithRandomNav` (randomized deposit size, NAV between 0.5x-1.5x
covering real losses as well as gains, randomized feeBps, full-balance redemption — chosen
deliberately over partial redemptions so the ghost-tracking code doesn't have to re-derive
`StewardAccount`'s own proportional `basisOut` rounding to stay correct) and `claimFees`.
Two new invariants: `invariant_accrued_and_claimed_fees_never_exceed_ghost_expected` (the
contract's own `accruedFees` + everything already claimed, checked against an
independently-computed ghost sum — not the contract's number compared to itself) and
`invariant_claimed_fees_never_exceed_accrued_fees`. 256 runs, 16,384 calls, 0 unexpected
reverts in the new handler path, both new invariants pass alongside all 5 pre-existing ones.

**Verified together, not just individually:** all 70 contracts tests pass (60 pre-existing +
8 `FeeOnYield.t.sol` unit tests + 2 TOCTOU regression tests), root `pnpm lint`/`typecheck`/
`test`/`build` and `apps/web`'s own gate all still pass unchanged — confirming the
zero-ripple design decision above actually held, not just in theory.

**Resolved via a fresh full run (see "Phase 6, third item" below):** the `reliability-auditor`
run noted above as stopped mid-run was superseded by a complete run covering both this module
and the Halmos/`PolicyMath` work together. That run returned FAIL — two real, unaddressed
findings, one of them a genuine O-09 (no-path-to-principal) violation. Both are fixed; see
below.

---

## 2026-09-23 — Phase 6, second item: Halmos symbolic verification of `PolicyMath`

Picked as the next Phase 6 item because it's self-contained (no external registry/API
research blocking it, unlike ERC-8004/Finance District/x402) and because `PolicyMath` had
**zero** existing test coverage of any kind (`grep -rn "PolicyMath" test/` returned nothing
before this entry) despite being the library every capacity/exposure/haircut calculation in
the system is specified to reduce to (`spec/accounting.md` sections 2 and 4).

**Setup, verified rather than assumed:** installed `halmos` via `pip install halmos`
(halmos-0.3.3). Ran `halmos --help` rather than trusting prior knowledge of its CLI —
confirmed the default test-name convention is `check_`-prefixed functions (not `test_`), and
that a plain Foundry-style test contract with primitive-typed parameters needs no special
cheatcode import — `pip show -f halmos` turned up no bundled `SymTest.sol`. Since
`PolicyMath`'s functions are `internal pure` inside a library (inlined at every call site, not
independently deployed), Halmos — like Foundry — needs an actual deployed contract to call
into, so `contracts/test/halmos/PolicyMathHarness.sol` is a thin `external pure` pass-through
with no logic of its own, and `contracts/test/halmos/PolicyMathSymbolic.t.sol` holds the
actual `check_`-prefixed symbolic properties, bounded to `uint128` (this project's own
on-chain money convention) to keep the SMT solver tractable.

**Five properties attempted; three proved for all inputs, two timed out (inconclusive, not
falsified):** `capMandate` never exceeds `maxVaultUsdc`, `capLiquid` never exceeds `treasury`,
and `computeCapacity`'s `headroom`/`overCap` are mutually exclusive all proved exhaustively.
`computeCapacity`'s "result never exceeds the min of its five input caps" and
`recognisedPositionValue`'s "haircuts never inflate value" both hit `[TIMEOUT]` at every
tried solver/timeout combination (default solver at 180s, explicit `yices` at 180s,
attempted `bitwuzla` but it requires a network binary download Halmos refuses by default —
declined to bypass that, since downloading and running an unreviewed binary mid-session is
exactly the kind of thing this repo's own engineering rules caution against for anything
touching money-path code). Confirmed this is not a bit-width scaling artifact by re-running
the haircut property bounded to `uint40` instead of `uint128` — still timed out at 60s — so
the chained multiply/divide in both properties is genuinely hard nonlinear arithmetic for an
SMT solver, not a "just needs more time" problem. Added `contracts/test/unit/PolicyMath.t.sol`
with `testFuzz_`-prefixed Foundry fuzz tests for all five properties (256 runs each) as
probabilistic, not exhaustive, coverage of the two Halmos couldn't decide — an honest partial
substitute, documented as such in that file's own header comment, not silently presented as
equivalent to a proof.

**A real bug, caught by the fuzzer on its very first run:**
`testFuzz_recognisedPositionValue_never_exceeds_navMark` failed immediately with a Solidity
`0x11` (arithmetic overflow) panic on `shares ≈ navPerShare ≈ type(uint128).max`,
`navScale = 4612922`. Root cause: `PolicyMath.recognisedPositionValue` computed
`(shares * navPerShare) / navScale` as a plain `uint256` multiplication before dividing —
when both operands approach `2^128`, the raw product approaches `2^256` and overflows before
the division ever happens, even though the *true* mathematical result (after dividing) fits
comfortably in `uint256`. This is a real availability bug (a DoS-by-revert on affected inputs,
not a fund-loss path — `recognisedPositionValue` is spec'd but not yet wired into any
state-changing on-chain call site, confirmed via `grep -rn "recognisedPositionValue"` across
`contracts/src`), but it's exactly the kind of thing that would have shipped silently if this
library's math had gone straight from spec to production without either a fuzzer or a
symbolic prover ever exercising its actual numeric edges — none of the hand-written unit
tests elsewhere in this codebase happened to pick inputs anywhere near this magnitude.

**Fixed properly, not by narrowing the input domain to dodge it:** switched to OpenZeppelin's
`Math.mulDiv` (`contracts/lib/openzeppelin-contracts`, already a dependency), which computes
`floor(a*b/c)` via a 512-bit intermediate and only reverts when the *true* result itself
doesn't fit in `uint256` — not whenever an unreduced intermediate product doesn't. Required a
second pass, not just the first: the haircut step
(`navMark * (BPS-issuerHaircutBps) * (BPS-latencyHaircutBps) / (BPS*BPS)`) had the identical
problem one level up — `navMark` alone can already be an enormous (~234-bit) number for
realistic-looking `uint128` `shares`/`navPerShare` paired with a small `navScale`, and
multiplying that by up to `1e8` before dividing overflows even though the final floor-divided
answer stays well under `uint256`'s ceiling. Fixed by precomputing the two haircut terms'
product first (each `<= BPS`, so their product is `<= 1e8`, always safe as a plain multiply),
then a single fused `Math.mulDiv(navMark, haircutProduct, BPS*BPS)` — deliberately one fused
call and not two sequential `mulDiv` calls, since two sequential floor-divisions can
double-round to a different answer than one combined floor, which would have broken the
documented byte-identical-with-`accounting.ts`/`accounting.py` guarantee this function's own
comment already commits to.

**Regression-tested and reverified:** added
`test_recognisedPositionValue_does_not_overflow_near_uint128_max`, pinning the exact
fuzz-discovered counterexample as a permanent named test (not just relying on the fuzzer to
rediscover it on a lucky seed). Also fixed the *test file's own* redundant `navMark`
comparison value in both the Halmos harness test and the new fuzz test file, which had the
identical plain-multiplication overflow risk independent of whatever the library itself did —
switched both to `Math.mulDiv` as well. Re-ran the full non-fork suite after the fix: 76/76
passing (70 pre-existing + 5 new `PolicyMath.t.sol` fuzz tests + 1 regression test), `forge
build` clean with no warnings. Re-ran Halmos after the fix on a from-scratch `rm -rf out
cache` build to rule out any stale-artifact effects: same result as before the fix — 3
proved, 2 timeout (never a counterexample) — consistent with the timeout being a solver
tractability limit, not something the overflow fix changed either way.

**What this leaves open, stated plainly:** `computeCapacity`'s min-of-five-caps property and
`recognisedPositionValue`'s haircut-never-inflates property are *not* exhaustively proved —
they have fuzz coverage (256 runs, not all possible inputs) and were manually reasoned
through above, but a determined adversarial input in the untested gaps between fuzz samples
could theoretically still exist. This is a real, bounded verification gap, not a resolved one
— recorded here rather than the Halmos run being quietly dropped once it stopped being easy.

---

## 2026-09-23 — Phase 6, third item: a real `reliability-auditor` FAIL, fixed

Ran a full `reliability-auditor` pass, per `CLAUDE.md`'s review-gate rule, covering both the
fee-on-yield module (the previous run had been stopped mid-run — see the "Open, not yet
closed out" note this entry supersedes) and the Halmos/`PolicyMath` work in the previous
entry, together. **Verdict: FAIL.** PolicyMath came back clean (all three of its questions
checked out — the `Math.mulDiv` fix is floor-parity-correct with `accounting.ts` across the
full domain, `computeCapacity`/`capMandate`/`capLiquid` have no analogous overflow risk, and
`recognisedPositionValue` really is unwired to any on-chain call site, confirmed by grep, so
the "availability bug, not fund-loss" characterization holds). The fee-on-yield module did
not — two real findings, one of them a direct O-09 violation.

**Finding 1 (the real one): rejected redemptions permanently burn `costBasis`, and the
recovered shares had nowhere to go.** `requestRedeem` debits `basisOut` from `costBasis`
*unconditionally*, before the redemption is known to succeed (`StewardAccount.sol`, right
before the adapter call). `reconcileRedemption` is the only place that ever revisits a
request, and it hard-requires `status == Finalized` — the real vault's own `RequestStatus`
enum also has `Rejected` (`IManagedVault.sol`), with a real reject path
(`MockManagedVault.rejectRedeem`, mirroring the deployed vault's confirmed behavior). Nothing
in the original implementation handled `Rejected` at all — `reconcileRedemption` just reverts
on it forever, and the debited `costBasis` never comes back. Concrete consequence: a rejected
request erases real principal from `costBasis`, so the *next* genuine redemption's
`gain = reconciledAmount - basisOutAtRequest` is overstated by exactly the erased amount,
charging `accruedFees` against returned principal, not yield — the exact thing O-09 exists to
prevent, reachable through a normal, spec'd vault outcome, not a contrived state. Compounding:
the vault mints a rejected request's shares back to whichever address called its
`requestRedeem` — always `ManagedVaultAdapter`, since `StewardAccount` never calls the vault
directly — and the adapter had no function to forward them anywhere, so they'd have been
stuck in it permanently, with zero recovery path, independent of the `costBasis` bug.

**Fixed with new code in both the adapter and the account, not a bounds-check patch.**
`ManagedVaultAdapter.recoverRejectedShares(requestId)` (`contracts/src/adapters/
ManagedVaultAdapter.sol`) recomputes the verdict from the vault's own `redeemRequests(id)`
tuple — status, the rightful `receiver`, the share amount — rather than trusting a
caller-supplied claim (`onchain-access-control` skill, check 3, consulted *before* writing
this one, not retroactively this time); reverts if the request isn't `Rejected`, if the
caller isn't that request's own `receiver`, or if already recovered once (a new
`rejectedSharesRecovered` mapping guards double-recovery, since the vault's mint-back is a
one-time event with nothing else in its own state to signal "already handled"). `IVaultAdapter`
gained the corresponding interface method, keeping `StewardAccount` vault-agnostic per its own
design goal. `StewardAccount.settleRejectedRedeem(requestId, ...)` (mirroring
`reconcileRedemption`'s shape and access control) recomputes the verdict the same way, restores
`costBasis += basisOutAtRequest[requestId]`, calls the adapter to pull the shares back, and
reuses the existing `requestReconciled` flag so the same request can't be double-processed by
either this function or `reconcileRedemption`.

**Finding 2: `reconcileRedemption` trusts a request-time preview as the final settled amount,
and the underlying assumption about the real vault's `finalizeRedeem` pricing was never
independently verified.** `exposureAtRequest[requestId]` (cached from `previewRedeemAssets` at
request time) is treated as the trusted "received" figure at reconcile time, with no
cross-check against the vault's own `redeemRequests(id).priceAtRequest` and no check of the
account's actual USDC balance delta. The real vault's redemption latency measured up to ~12.7
days (Phase 0, this file) with `maxNavChangeBps = 5000` — real elapsed adversarial time during
which NAV can move substantially — and `finalizeRedeem` itself is operator-only, never in
`IManagedVault.sol`'s declared surface, so its actual settlement-pricing logic has never been
read from verified BSC source. Per `CLAUDE.md`'s own source-of-truth ordering (reproduced
behavior outranks tests, tests outrank spec, spec outranks assumption), this is exactly the
gap that rule exists to catch, and the fee module was built on top of it without closing it.
**Not fixed in this entry — genuinely open, recorded honestly rather than patched over with
a guess.** Closing it needs the real, deployed vault's verified `finalizeRedeem` source read
(a `docs/API_NOTES.md`-grade research step, not a code change) before `reconcileRedemption`
can be taught to cross-check against it. Until then, Mode A's actual (not fork-simulated)
finalize pricing behavior remains unmeasured, and this function's trust in the request-time
preview should be treated as a known, load-bearing assumption, not a confirmed fact —
recorded here and in `docs/LIMITATIONS.md`, not silently carried forward.

**TDD on the fix that was made:** six new tests added to `contracts/test/unit/FeeOnYield.t.sol`
before touching `StewardAccount.sol`/`ManagedVaultAdapter.sol` — confirmed failing to compile
first (`settleRejectedRedeem` didn't exist), including
`test_rejected_redemption_does_not_let_a_later_real_gain_overstate_fee`, which reproduces the
auditor's exact exploit sequence end-to-end (reject-and-settle, then a genuine 20% gain on the
same restored principal, asserting the fee reflects the real gain, not the erased-then-restored
basis). All 16 `FeeOnYield.t.sol` tests and the full 82-test non-fork suite pass after the fix,
`forge build` clean with no warnings.

**Fuzz-level coverage added too, not just the one hand-picked regression.**
`contracts/test/invariant/StewardAccountInvariants.t.sol`'s `Handler` gained
`depositRequestRejectAndSettle`, asserting `costBasis` is exactly restored and shares are
exactly recovered (including that nothing is left stuck in the shared adapter) after every
random reject-then-settle sequence the fuzzer constructs — not just the one scripted scenario.
Ran clean across the full 256-run / 16,384-call invariant suite, ~2,000+ calls to this
specific function, 0 assertion failures.

**A second, independent `reliability-auditor` pass, scoped specifically at this fix, verified
it.** Traced the access-control logic by hand (the `receiver` field is bound per-request to
the originating `StewardAccount` at the vault level, permanently, so `msg.sender != receiver`
in `recoverRejectedShares` cannot be spoofed regardless of the adapter being one shared
instance across every account the factory creates), confirmed checks-effects-interactions
ordering in both `settleRejectedRedeem` and `recoverRejectedShares` (state written before the
external call in both), confirmed the shared `requestReconciled` flag fully blocks every
double-processing combination independent of vault status, and confirmed
`basisOutAtRequest[requestId]` can only ever be restored once (gated by that same flag) so no
overflow path exists. **Verdict: finding 1 CLOSED** — correct, no new issues introduced.

**One real gap it did find: the fix's own two access-control guards had zero test
coverage.** `recoverRejectedShares`'s `NotRequestReceiver` and `AlreadyRecovered` reverts were
logically sound but untested in isolation — every existing test path only ever reached this
function as the correct, first-time receiver, so deleting either guard would not have failed
any test. This is exactly the gap `CLAUDE.md`'s own rule exists to catch ("a guard that exists
to prevent fund loss ships with a test that fails if the guard is deleted"). Fixed: new
`contracts/test/unit/ManagedVaultAdapter.t.sol` (no adapter-level test file existed before
this), going through the adapter directly rather than via `StewardAccount`, isolating these
guards from `StewardAccount`'s own `requestReconciled` gate. Verified each new test is actually
load-bearing, not just passing by coincidence: temporarily deleted the `NotRequestReceiver`
check, confirmed `test_recoverRejectedShares_reverts_for_a_caller_that_is_not_the_receiver`
failed as expected, then restored it — the same "prove the test would catch the regression"
discipline used throughout this session rather than trusting a green run at face value. Full
suite after all of this: 86/86 non-fork tests pass (82 + 4 new adapter tests), `forge build`
clean with no warnings.

---

## 2026-09-23 — Phase 6, fourth item: closing the `finalizeRedeem` pricing gap for real

The "Phase 6, third item" entry above documented Finding 2 as an *open, unverified*
assumption: `reconcileRedemption` trusts the request-time preview as the settled amount, and
whether the real vault's `finalizeRedeem` actually prices that way had never been checked
against real source. `CLAUDE.md`'s own engineering rule is explicit that closing this needs
"the real, deployed vault's verified `finalizeRedeem` source read... before
`reconcileRedemption` can be taught to cross-check against it" — so that's what this entry is:
the research step, followed through to an actual fix once the research turned up a real,
confirmed divergence rather than the benign case.

**The research.** `bscscan.com`'s contract-source UI returned HTTP 403 (anti-bot), and the
old `api.bscscan.com/api` endpoint now 301-redirects to Etherscan's unified V2 API, which
requires an API key this session doesn't have and won't read from `.env` (`CLAUDE.md`).
Fell back to web search, which surfaced a real, public repository:
`github.com/IXS-Finance/vault-contracts` — Foundry project, "Smart contract of IXS Vault,"
containing `contracts/ManagedVault.sol` directly. Read via two independent `WebFetch` passes
(the tool summarizes through a small model, so a load-bearing finding got a second,
differently-phrased pass before being trusted) that agreed on every detail:

- `finalizeRedeem` computes the payout from the **live `pricePerShare` at the moment finalize
  is called**, using `request.shares.mulDiv(pricePerShare, 10**decimals(), Floor)` — not
  `request.priceAtRequest`.
- The real `RedeemRequest` struct's own field comment says as much: `priceAtRequest` is
  "indicative price at request — audit trail only; finalization uses live NAV."
- The actual net payout amount is **not written back anywhere retrievable** — no mapping, no
  struct field update beyond `status`/`processedAt`. A `RedeemRequestFinalized` event carries
  it, but on-chain contracts cannot read another contract's historical event logs — there is
  no way for `StewardAccount` to look up "what did request #N actually settle for" after the
  fact, from the vault alone.

This directly contradicts what `StewardAccount.reconcileRedemption` and
`MockManagedVault.finalizeRedeem` both assumed (that the request-time preview IS the settled
amount) — and it's not a theoretical mismatch: Phase 0 already measured real redemption
requests taking up to ~304.6 hours (~12.7 days), with `maxNavChangeBps = 5000` (a single NAV
update can move price 50%). Any redemption spanning real time with NAV movement would have
had its `gain`/fee silently miscalculated against the stale preview instead of what actually
came back.

**The fix, in three parts.**

1. **`MockManagedVault.finalizeRedeem` corrected to match the real vault**: pays
   `(r.shares * navPerShare) / 1e18` using the *live* `navPerShare` at the call, not
   `r.priceAtRequest`. Verified this doesn't silently change any existing test's expected
   values: every existing `setNavPerShare` call in the whole suite happens *before*
   `requestRedeem`, with NAV held constant through finalize — so request-time and finalize-time
   price were already identical everywhere except the new tests below, which deliberately move
   NAV in between to exercise the real divergence.

2. **`reconcileRedemption` no longer trusts `exposureAtRequest[requestId]` as "received."**
   Since the real vault provides no readable settled-amount record, the true received amount
   is derived from an exact USDC balance delta instead — which only works if the delta is
   attributable to exactly one redemption. So `requestRedeem` now gates on a new
   `pendingRequestId` (0 = none in flight): only one redemption can be outstanding per account
   at a time. Every OTHER function that can move this contract's own USDC while a redemption
   is pending — `deposit`, `withdraw`, `claimFees` — records its own effect into
   `outflowsWhilePending` as it happens. At reconcile: `grossReceipts = currentBalance +
   outflowsWhilePending` (what the balance would be if none of those other outflows had
   happened) minus `balanceAtRequestTime` (the snapshot taken when the request was made)
   isolates exactly what the redemption itself added — computed as one addition and one
   safely-clamped subtraction (`grossReceipts > balanceAtRequestTime ? ... : 0`) so there's no
   intermediate that could underflow even when outflows exceed the eventual payout (a real
   loss scenario). No untracked inflow path exists for anything OTHER than the redemption
   payout itself: this contract never approves any address but the adapter to pull its USDC,
   so the balance can't move for a reason this accounting doesn't already know about — except
   an arbitrary third-party `transfer()` donation directly to the account, which would only
   ever inflate the apparent gain (free money misattributed as yield, not a principal-loss
   path), noted as a known minor edge case rather than something worth defending against here.

3. **A real, deliberate liveness tradeoff, stated plainly, not hidden.** Serializing
   redemptions means if the vault operator never finalizes or rejects a pending request, the
   account can never request another redemption — a real risk given `finalizeRedeem` is
   operator-controlled and asynchronous. This is a new failure mode this fix introduces in
   exchange for exact balance-delta accounting; no emergency-override/force-clear function was
   added, since that would need its own careful gating and risks becoming a new attack surface
   under time pressure, for a hackathon-scope deliverable. Documented as an accepted, known
   limitation in `docs/LIMITATIONS.md` and `docs/THREAT_MODEL.md`, not papered over.

**TDD, and a real bug caught in my OWN test, not just the contract fix.**
`test_reconcileRedemption_uses_actual_received_amount_not_stale_preview` (deposit 100, NAV
1.0 at request, NAV rises to 1.3 during the pending window, real payout 130) confirmed the old
code's bug directly: it would have computed `gain = preview(100) - basisOut(100) = 0`, losing
the operator's entire real 3-unit fee entitlement. `test_requestRedeem_reverts_while_a_redemption_is_already_pending`
and `test_deposit_while_redemption_pending_does_not_corrupt_received_amount` written and
confirmed failing to compile/fail before the fix existed, per `CLAUDE.md`'s TDD rule. The
first attempt at the interleaved-deposit test itself had a real bug: it called `usdc.mint()`
directly on the account mid-scenario to fund a second deposit, an untracked raw inflow no real
on-chain event could produce, which corrupted the balance-delta math it was trying to verify —
found by the test failing with an unexpected number, not by inspection, and fixed by funding
from the pre-existing idle balance `setUp()` already provides instead. Separately, my *first*
version of the balance-delta formula itself had the subtraction backwards
(`balanceAtRequestTime + outflowsWhilePending` instead of `currentBalance + outflowsWhilePending
- balanceAtRequestTime`) — caught by the same interleaved-deposit test failing with a
wrong-but-plausible number (an easy sign error to miss by inspection alone), not by a
different, more obviously-wrong failure. Fixed and re-verified.

**Fuzz coverage extended to the specific scenario that caused this bug**, not just the fixed
mechanism in isolation: `depositRedeemAndReconcileWithRandomNav` in
`contracts/test/invariant/StewardAccountInvariants.t.sol` now draws NAV **twice** — once at
request, once again before finalize — so the fuzzer specifically exercises NAV moving during
the pending window on every run, not just holding it constant through one cycle the way it did
before. The ghost fee calculation was updated to use the finalize-time settled amount, matching
what both the corrected mock and the corrected `reconcileRedemption` now agree on. 256 runs,
16,384 calls, 0 unexpected reverts, all 7 invariants (including both O-09 checks) still pass.

**A second real bug caught by the compiler, the same way as before in this session**: `forge
build`'s `unsafe-typecast` warning fired on the new `reconciledAmount` cast even with a
`disable-next-line` comment attached — because the comment was placed above the wrong physical
line of a multi-line ternary (the exact same placement pitfall from the "Phase 6, first item"
entry, repeated because the ternary was reformatted mid-edit and the comment didn't move with
it). Fixed by moving the directive to the ternary's actual cast line and writing the real
safety justification (the cast only fires when the subtraction result is guaranteed positive,
and USDC amounts in this system's realistic range are nowhere near uint128's ceiling) instead
of just silencing the warning.

**Verified together:** all 89 non-fork tests pass (88 unit tests across 8 files + 1 invariant
suite covering all 7 Handler functions), `forge build` clean, zero warnings. Documentation
updated in `docs/API_NOTES.md` (the real `finalizeRedeem` source finding, measured not
assumed), `docs/LIMITATIONS.md`, and `docs/THREAT_MODEL.md` (the new serialization liveness
tradeoff).

---

## 2026-09-23 — Phase 6, fifth item: ERC-8004 bridge — G2 verified real, plan's mechanism found impossible, adapted

`serv PLAN_v3.md` §12 lists Phase 6 as exactly six items (not the seven this session's own
earlier reply to the user briefly, incorrectly implied by adding "operator mode (several
owners)" as a distinct item — that phrase only appears in the superseded `serv PLAN_v2.md`
§7.6 draft, alongside "loosen-delay tuning," neither carried forward into v3's own list;
corrected in `docs/LIMITATIONS.md`/`README.md` alongside this entry): ERC-8004 bridge,
fee-on-yield module, x402-priced verification, multi-vault, Finance District adapter, Halmos
on `PolicyMath`. `docs/LIMITATIONS.md`'s "ERC-8004 registry (G2)" had this marked "Not
checked... Deferred" since Phase 0. This entry is that check, done for real, plus what came
of it.

**G2, actually verified, not just addressed.** `bscscan.com`'s UI returned HTTP 403
(anti-bot) and the old `api.bscscan.com/api` now redirects to a v2 API requiring a key this
session won't read from `.env`. Web search surfaced the real, official
`github.com/erc-8004/erc-8004-contracts` repo (curated by the 8004 team) listing BSC mainnet
addresses: `IdentityRegistry` at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
`ReputationRegistry` at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Per this project's own
source-of-truth ordering (reproduced behavior over docs), didn't stop at the repo listing —
ran `cast code <address> --rpc-url https://bsc-dataseed.binance.org` against BOTH directly:
real, non-empty bytecode at both, confirmed live on BSC mainnet right now. G2 closed for real.

**The plan's stated mechanism for this item — "owner-posted feedback from tier events" —
turned out to be impossible against the real contract, not just unbuilt.** Read the actual
verified `ReputationRegistryUpgradeable.sol` source (two independently-phrased `WebFetch`
passes agreeing, the same discipline used for the `finalizeRedeem` finding above, since this
is equally load-bearing). `giveFeedback` contains:
```solidity
require(!IIdentityRegistry(_identityRegistry).isAuthorizedOrOwner(msg.sender, agentId), "Self-feedback not allowed");
```
There is no legitimate pathway for an agent's own owner (or anything the owner controls) to
post feedback about that same agent — the real protocol is built for independent third-party
clients to rate an agent, not for self-attestation, closer to how a driver can't rate
themselves on a ride-sharing app. The plan's own premise for this item doesn't hold against
the real, deployed contract.

**Surfaced to the user rather than silently reinterpreting the scope.** Given how
consequential this is (a planned deliverable, impossible as specified, discovered mid-task
under an open-ended "complete all remaining Phase 6 work" instruction), stopped and asked
rather than guessing what to build instead. Chosen path: register a real ERC-8004 identity
(the part that IS real and buildable) plus tooling for an independent third party to post
accurate feedback (the closest faithful adaptation of the original intent that doesn't
violate the contract's actual rules) — not silently dropping the item, not building something
that pretends to work around a real protocol restriction.

**Built and verified against the real, live registry — not just against a mock.**
`contracts/src/interfaces/IERC8004IdentityRegistry.sol` (minimal interface, reconstructed
from the real verified source, same convention as `IManagedVault.sol`) and
`contracts/src/adapters/ERC8004IdentityBridge.sol`: one bridge instance per StewardAccount,
immutably bound to it at construction (zero ripple into `StewardAccount.sol` itself — reads
only its public `owner()` getter), owner-gated `register`/`updateAgentURI`. Deliberately
holds the identity NFT itself rather than having the account's owner call the real registry
directly: the real `register()` makes `msg.sender` the new agentId's owner with no "on behalf
of" parameter, so a direct call from an EOA/multisig owner would leave the identity with no
on-chain link back to which StewardAccount it represents — routing through this bridge keeps
that link permanent and on-chain.

`contracts/test/fork/ERC8004Identity.t.sol`, run against a real fork of live BSC mainnet
(`forge test --match-path "test/fork/ERC8004Identity.t.sol" --fork-url
https://bsc-dataseed.binance.org`, zero funds spent, nothing broadcast to live BSC — same
zero-funds/fork-only discipline as `test/fork/ModeA.t.sol`), caught a real bug on its first
run: every registration attempt reverted `ERC721InvalidReceiver`. The real registry mints via
OpenZeppelin's `_safeMint`, which calls `onERC721Received` on any contract receiver and
reverts the whole mint if it doesn't return the right selector — `ERC8004IdentityBridge`
didn't implement it. Fixed by implementing `IERC721Receiver`. Re-ran against the real
registry: 7/7 passing, including confirming the bridge (not the account owner directly) ends
up holding the real NFT, `tokenURI` reads back what was set, and both access-control guards
(`NotAccountOwner`, `AlreadyRegistered`) hold. This is exactly the kind of finding that would
never have shown up against a hand-written mock of the registry — only the real deployed
contract's own actual `_safeMint` behavior surfaces it.

**Third-party feedback tooling, the adapted half.** `scripts/generate-erc8004-feedback.ts`
(same read-only, no-key `cast call` pattern as `scripts/live-health-snapshot.ts`) reads a
StewardAccount's real on-chain conduct — current tier (`tierState()`), and the
`ConductRegistry` record for its agent key (`accountsCount`, `distinctOwnersCount`,
`totalRiskUnits`, lifetime `incidentCount`, `maxTierReached`, `firstSeen`,
`cleanStreakStart`) — and prints every raw field plus a spec-compliant feedback JSON payload
(`agentRegistry`, `agentId`, `createdAt`, `value`/`valueDecimals`, `tag1`/`tag2`, `endpoint`
per `ERC8004SPEC.md`) with a documented, adjustable suggested score (25 points per current
tier, up to 20 bonus points for a clean streak saturating at 90 days, -10 points per lifetime
incident, clamped 0-100) — explicitly labeled as a starting point for a real reviewer to
adjust, not an authoritative figure. `clientAddress` is deliberately left as a placeholder for
whoever actually submits it: filling it with any address this project controls would just be
self-feedback under a different name. `feedbackHash` uses `cast keccak` (Ethereum's real
keccak256) — an earlier draft used Node's `crypto.createHash("sha3-256")`, which is NIST
SHA3, not Keccak; they differ in padding and would have produced a hash the real chain could
never verify against. Caught before shipping by checking what `cast` actually offers rather
than assuming Node's built-in crypto module covered it — this project's own established
"verify a new primitive's real behavior, don't assume" discipline, applied to a hashing
primitive this time instead of a tool's CLI.

**Not run end-to-end against a live account, honestly stated.** Unlike the identity bridge
(verified against the real registry directly), this script's own `cast call` reads against a
StewardAccount's `tierState()`/`agent()`/`conductRegistry()` and `ConductRegistry.recordOf()`
were verified by careful manual signature review against the actual struct declarations in
`contracts/src/libraries/Types.sol` and `contracts/src/ConductRegistry.sol` (field-by-field,
confirming every cast type-tuple signature matches), not by a live run against a deployed
account — the persistent local fork from earlier in this session had already been reaped for
memory pressure, and starting a fresh one was declined per the explicit instruction not to
restart it without being asked. `cast call`'s signature matching fails loudly (a decode error,
not silently wrong data) if any of this drifted, so a mismatch would surface immediately on
first real use, not corrupt data quietly — but "verified by review" and "verified by running"
are different tiers of confidence, and this is the weaker one, stated as such rather than
implied otherwise.

**Verified together:** `forge build` clean, `forge test --no-match-path "test/fork/*.t.sol"`
still 89/89 (the new files don't touch anything existing), `forge test --match-path
"test/fork/ERC8004Identity.t.sol" --fork-url https://bsc-dataseed.binance.org` 7/7 against
the real registry. `node --experimental-strip-types scripts/generate-erc8004-feedback.ts`
(no args) prints its usage message and exits cleanly, confirming no import/syntax errors.

---

## 2026-09-23 — Phase 6, sixth item: x402-priced verification endpoint

The last of Phase 6's six items. Real, official protocol (x402, donated by Coinbase to the
x402 Foundation, launched under the Linux Foundation 2026-07-14) — researched the actual
current API surface before writing code, same discipline as every other Phase 6 item, not
assumed from prior knowledge (the CLI/package landscape for this protocol has moved fast
enough that a stale assumption would likely have been wrong).

**First problem: there was nothing server-side to gate.** x402 is fundamentally a
server-side HTTP mechanism (a server responds 402, the client retries with proof of payment)
— but `apps/web/app/verify` (the Phase 5 Verifier) runs entirely client-side, no API route,
no server round-trip at all (confirmed by `find app/api -type f`: only
`app/api/honeypot/notices/route.ts` existed before this entry). Nothing to charge for. Built
`app/api/verify-paid/route.ts`, a new server-side API route exposing the exact same
verification logic `/verify` already uses (`lib/chain.ts`'s `readAccountState`/
`fetchAccountHistory`, `lib/replay.ts`'s `replayHistory` — reused unchanged, not
reimplemented, so there's one verification codepath to keep correct, not two).

**Second problem, checked before assuming: does x402 even support BSC, where this project's
own vault lives?** Read the real settlement-contracts directory
(`github.com/x402-foundation/x402`, `contracts/evm`) — CREATE2-deployed to Base, Arbitrum,
World Chain, Polygon, Optimism, Avalanche, Celo, Linea, Unichain, and Monad mainnets, plus
Base Sepolia and World Chain Sepolia testnets. **BSC is not among them.** Rather than
self-deploying someone else's audited settlement contracts to a new mainnet (real deployment
risk, explicitly out of this build's scope) or forcing a mismatch, used Base Sepolia
(`eip155:84532`) instead — the real, official protocol and a real, official hosted
facilitator (`https://x402.org/facilitator`, no self-hosting needed), against a public
testnet where the payment token has no real value. Same "real protocol, zero real funds at
risk" spirit as this project's own BSC fork-only path, on a different chain because that's
genuinely where x402's real infrastructure exists today — stated plainly as a deliberate
choice, not silently glossed over as "the same chain."

**Next.js 16 breaking change, caught before it caused a silent no-op:** this repo's
`apps/web` runs Next.js 16.3.5, and `AGENTS.md` (generated by `next dev` itself) explicitly
warns training data may be stale for this version. Checked
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`
before writing anything: `middleware.ts` is deprecated in Next 16, renamed to `proxy.ts` —
same function signature, different file/export name. `@x402/next`'s own docs still reference
the old convention in places. Used `proxy.ts` per the installed Next version's real
requirement, not the package docs' possibly-stale example.

**A real naming collision in the installed package, caught by `tsc`, not by reading docs.**
`@x402/next`'s documented quickstart example imports `ExactEvmScheme` from `@x402/evm`'s
package root. Doing that and passing it to `x402ResourceServer.register()` failed to
type-check: `Type 'ExactEvmScheme' is missing... defaultAssetTransferMethod, paymentFlows,
parsePrice, enhancePaymentRequirements` and `Expected 1-2 arguments, but got 0`. Read the
installed package's own `.d.ts` files directly (ground truth once installed, more reliable
than a `WebFetch`-summarized doc page) and found the real cause: `@x402/evm` exports **two
different classes both named `ExactEvmScheme`** — the package root re-exports the
**client**-side one (`constructor(signer, options?)`, for making payments), while the
**server**-side one (for verifying/pricing them, what a resource server actually needs) lives
at the separate `@x402/evm/exact/server` subpath. Fixed by importing
`registerExactEvmScheme` from that subpath instead of manually constructing the wrong class —
the same subpath's own `.d.ts` file had this exact usage pattern documented in a doc comment,
found by reading the type declarations end to end rather than stopping at the first plausible
import.

**Verified live, not just type-checked.** Started a real `next dev` server and issued a real
HTTP request to `/api/verify-paid` with `curl`. Got back a real `402 Payment Required` with a
`payment-required` header — decoded it: `{"x402Version":2,...,"accepts":[{"scheme":"exact",
"network":"eip155:84532","amount":"10000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
"payTo":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","maxTimeoutSeconds":300,
"extra":{"name":"USDC","version":"2"}}]}` — every field correct: the real USDC asset address
on Base Sepolia (resolved automatically by the package's own default-asset registry, not
hardcoded by this project), the configured `$0.01` price correctly converted to `10000` (USDC's
6 decimals), the configured `payTo` fallback address. This is exactly the kind of thing that
would have looked fine at the type level while being subtly wrong at runtime (a misconfigured
network string, a price that doesn't resolve to a real asset) — checked for real instead of
assumed.

**`payTo` is a well-known Anvil test address by default, not a real receiving wallet** — this
project has no real treasury key, and inventing one would misrepresent a demo as something it
isn't. `X402_PAY_TO_ADDRESS` in `.env.example` documents how a real deployment would override
it.

**Regression test added and confirmed passing against a live server**, not just claimed:
`apps/web/e2e/verify-paid.spec.ts` — asserts the real 402 status, decodes the real header,
checks every field of the real payload, and confirms an unrelated route is NOT gated (the
`matcher` config actually scopes correctly). Ran with `BASE_URL=http://localhost:3939 npx
playwright test e2e/verify-paid.spec.ts` against a real dev server: 2/2 passing. Unlike most
of this repo's other e2e specs (which need a funded wallet, a live fork, or real demo-state
files and skip cleanly on a cold CI runner), this one needs none of that — the 402 challenge
is generated locally without contacting the real facilitator, so it's added to
`.github/workflows/ci.yml`'s existing cold-runner-safe test set, not left manual-only.

**Update, same day: the payment-and-retry half is now tested too, closing the gap above.**
The user funded a fresh, throwaway Base Sepolia keypair (`cast wallet new` — never a
real-value key) with testnet ETH (Coinbase's faucet) and testnet USDC (`faucet.circle.com`).
`apps/web/scripts/live-x402-payment-test.ts` uses the official `@x402/fetch` client
(`wrapFetchWithPaymentFromConfig` + `ExactEvmScheme`, the CLIENT-side class from `@x402/evm`'s
package root this time — correctly the opposite of the server-side one `proxy.ts` needed,
same real naming collision noted above) to make a real request against a real running server.
Result: `Final status: 502` (not 402) with a real viem RPC error for the deliberately-fake
`rpcUrl` — proof the request cleared the payment gate and reached the actual route handler.
Confirmed independently on-chain, not just by trusting the client's own success report: the
wallet's real USDC balance dropped from 20.00 to 19.99 — exactly the configured $0.01 price,
verified via a direct `cast call balanceOf` before and after. **A real, complete, on-chain
settled x402 payment**, not a simulation. (A real Node ESM resolution issue surfaced getting
here: this script needs `@x402/fetch`/`@x402/evm`/viem, all only installed in `apps/web`'s
workspace — Node resolves packages by walking up from the *importing file's own path*, not
the process's CWD, so the script had to live inside `apps/web/` itself, not the root
`scripts/` folder where every sibling script lives; a root-level attempt failed with
`ERR_MODULE_NOT_FOUND` even when run with `cwd` set to `apps/web`.)

**Verified together:** `pnpm lint` (root) clean, `npx tsc --noEmit` (apps/web) clean, real
`next dev` run confirms the live 402 behavior, `playwright test e2e/verify-paid.spec.ts` 2/2
passing. `contracts/`'s own 89-test non-fork suite is untouched by this entry (this item is
entirely in `apps/web`, no Solidity changes).

**Four of Phase 6's six items are now done** — fee-on-yield module, Halmos verification of
`PolicyMath`, ERC-8004 bridge (adapted), and this x402 endpoint (the `finalizeRedeem` pricing
fix isn't a separate plan item — it grew out of the fee-on-yield module's own review-gate
finding, real work this phase's scope expanded to include, not a sixth thing). **Multi-vault
and the Finance District Agent Wallet adapter remain genuinely unstarted** — both larger,
more architectural undertakings than the four done so far, not yet attempted. Every item that
turned out to diverge from its original plan description — ERC-8004's self-feedback block, the
real vault's live-NAV pricing, x402's BSC gap — was researched against real, verified sources
before writing code, and every divergence from the plan's original words is recorded here
rather than silently reconciled after the fact.

---

## 2026-09-23 — Multi-vault, clarified and resolved: G2's real answer is N=1, feature deferred

The exchange above ("Phase 6, seventh item," now removed) implemented the wrong
interpretation of "multi-vault": a factory-level change (`createAccount` taking an adapter
parameter) letting one `StewardFactory` create accounts against different vaults, each
account still single-vault. The user clarified the actual intent, unresolved since
`serv PLAN1.md` line 454 ("Multi-vault support if Compass lists more IXS vaults") and line
511 (open question #1: "Is any IXS vault other than the Agentic/Permissionless one listed by
Compass for BNB?"): **one StewardAccount/agent allocating across more than one vault
contract simultaneously** — the mandate's own `vaults[]` sense, not multi-tenant (many
owners — a separate, uninvestigated "operator mode" item from `serv PLAN_v2.md`), not
multi-chain, not multi-asset. This was gated on that Phase 0 question, never actually
answered before this entry — `spec/DECISIONS.md` had no record of it, confirmed by grep
before this session assumed otherwise.

**Reverted the factory-level change in full**: `StewardFactory.sol` back to a single
`adapter` immutable at construction, `createAccount`'s signature and `AccountCreated` event
back to their original shapes, every one of the 8 call sites (2 deploy scripts,
`scripts/demo-driver.ts`, 5 test files) reverted to match, the 2 new tests removed. Verified
`forge build` clean and the full non-fork suite passes at the same 89/89 as before this
detour — a real behavior change was introduced and then fully backed out, not left as
half-applied cruft.

**G2's real question, finally answered with a real API call, not inference from docs.** The
user supplied a real Compass API key (`COMPASS_API_KEY`, added to the gitignored `.env`, not
read back or echoed — `.env.example` documents the variable). `GET
https://api.compasslabs.ai/v2/tokenized_assets/markets?provider=ixs&chain=bsc` with that key:

```json
{"markets":[{"symbol":"ixv1","underlying_ticker":"USDC","name":"IXS Managed Vault","contract_address":"0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82", ...}]}
```

Exactly one market, the same vault this entire project already targets. **G2 is closed for
real: N=1.** There is currently nothing for a multi-vault allocation feature to allocate
across. Before this real API call, the best available evidence was consistent public
documentation (Compass's own IXS vault guide references one vault throughout) — directionally
right, but an inference, not a verified fact; the real authenticated call is what actually
closes this per `CLAUDE.md`'s own source-of-truth ordering.

**Deferred, not built** — per the user's own gating logic, confirmed to hold: building a real
allocation-across-vaults feature with only one real vault to allocate to would be
architecturally speculative (a multi-day rearchitecture — exposure/capacity/costBasis/fee
tracking all becoming per-vault or aggregated, touching nearly every function this session has
already built and tested) and untestable against any second real vault. Revisit if/when
Compass's `markets` endpoint for `provider=ixs&chain=bsc` ever returns more than one entry —
`make`-able as a standing check: `curl -s -H "x-api-key: $COMPASS_API_KEY"
"https://api.compasslabs.ai/v2/tokenized_assets/markets?provider=ixs&chain=bsc"`.

---

## 2026-09-24 — Phase 7: checking the submission docs before they go anywhere

**Starting state.** When this session resumed, another session on the same repo (`custos-3e`)
had already written `docs/honeypot-report.md`, rewritten the README (judge fast path,
"Compared to", known gaps) and added the measurement report's "Claimed" section. None of it
was overwritten. Instead every checkable claim was re-derived on 2026-09-24.

**Re-derived and unchanged:** Foundry 89 passed, 0 failed; off-chain tests 23 + 23 + 6 + 26 = 78
passed; differential 118 of 118 identical; Halmos 3 proved and 2 timed out (same as before);
root `pnpm lint`/`typecheck`/`build` clean; offline eval 21 of 21 scenarios pass (added to the
README and honeypot report, which had no eval number); honeypot notice store empty.

**Corrected:**

1. **Measurement report headline understated the tail.** The percentile counts only
   `Finalized` requests (`spec/health.md` §2, `packages/engine/src/health.ts:30`). A fresh
   snapshot (block 123,735,963) showed 2 of the vault's 8 requests still pending after 107 days
   (id 2, 0.1 share, dust) and 63 days (id 6, 96.3 shares, about 105 USDC), against a reported
   "max 12.7 days". The report now shows all eight requests, states that 12.7 days is the
   slowest settled request, and gives no cause because the chain data doesn't. The README,
   `docs/LIMITATIONS.md` and `docs/THREAT_MODEL.md` say the same. The Phase 6 serialization
   tradeoff (a request the operator never settles blocks that account) was already recorded as
   a real risk; this shows the state exists on the real vault today. n = 8, so it is evidence
   the failure mode exists, not a rate.
2. **Compass quotes are now verified.** The report said its quotes came through a summarizing
   fetch and weren't byte-exact. All three now match the live page's HTML byte for byte; the
   page uses typographic apostrophes, which the earlier copy had normalized.
3. **`spec/health.md` cited a command that doesn't exist and a check that doesn't run.**
   `make verify-health` had been a stub (now removed) and nothing in `apps/web` reads health
   snapshots, so "mismatch is flagged in the verifier" was false. Corrected in place.
4. **"Compared to" table rewritten from the projects' own docs.** Old rows said WAIaaS is a
   "binary gate" (its tiered thresholds map score and amount to INSTANT/NOTIFY/DELAY/APPROVAL),
   and cited "Phalnx / agentshield" for risk-reducing exemptions. No Phalnx turned up in any
   search, and the `agentshield` that does exist is an agent-config security scanner. Both
   dropped. Warden is real and its `rampUpPolicy` template raises limits over time, so the
   novelty claim is now stated narrowly (a predicate over replayable history, not a schedule).
5. **Plan claim table not repeated.** `serv PLAN_v3.md` §11 lists C5 as "5,000+ generated
   cases" (actual: 118 curated), C6 as a measured SERV vs. raw comparison (the live half needs a
   key and hasn't been run; only the offline half exists), and C8 as `make verify-health`
   (removed). The README states only what was run.

**Deliberately not changed:** the health engine still ignores pending requests. Publishing the
oldest pending age changes the `HealthSnapshot` struct across Solidity, TypeScript, Python and
all 118 fixtures, which isn't a safe change this close to submission. It's listed as a
follow-up in `docs/LIMITATIONS.md`.

**Still open, all owner actions:** send the measurement report to IXS and Compass; add a
LICENSE (done later the same day: MIT, holder `Dami904`); commit and push the repo (there are no commits yet) so CI
and a public link exist; record the demo; have one non-technical person try `/demo`.

---

## 2026-09-26: Hosting, and a real vault finding that changed the demo run

**Hosted web app (Vercel, https://steward-rwa.vercel.app).** On a hosted deployment the
server-side chain reads ignore visitor-supplied RPC URLs (SSRF) and read only `FORK_RPC_URL`
(`apps/web/lib/deployment.ts`, guard test in `deployment.test.ts`).

**The saved demo state could not be hosted.** Loading `.fork-state/anvil-demo-state.json`
three ways: offline, the vault's implementation code was missing; with the public upstream,
Anvil forked at the latest block and the demo's blocks were gone; pinned to the demo's block,
Anvil would not start ("state at block #123520782 is pruned").

**Re-ran the demo; the real vault refused deposits.** `ERC4626ExceededMaxDeposit(max = 0)`.
On live BSC: NAV last set 2026-09-23 01:12 UTC, threshold 48 h, so `maxDeposit` = 0 for
everyone since about 2026-09-25 (details: `docs/measurement-report.md`). Options put to the
owner: refresh the NAV on the fork at the unchanged price, or wait for IXS. **Decision: refresh
on the fork** (`refreshStaleVaultNav` in `scripts/demo-driver.ts`), via the real NAV manager
(found from the last `setNAV` tx, `hasRole` checked live), recorded as the `FORK_nav_refresh`
step, skipped automatically when the NAV is fresh. Stated in `LIVE.md` and
`docs/LIMITATIONS.md`.

**Self-contained demo chain.** After the run, every account and storage slot any demo tx
touched (prestateTracer over all 24 txs: 15 accounts, 67 slots) was written back with its
current value, so the dump (`deploy/demo-chain/state.json`) serves with no upstream.
Verified by rendering `/verify`, `/app` and `/honeypot` against the live fork and the offline
copy: identical text. Served on Render (https://steward-demo-chain.onrender.com) behind a
read-only proxy; audits: reliability-auditor PASS after fixing 5 findings, dx-auditor findings
addressed (docs, `.gitignore` note, CI image smoke job).
