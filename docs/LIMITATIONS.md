# Limitations

What's explicitly not handled yet, stated plainly, as of Phase 7 (submission docs; the
per-phase sections below are kept as written). See
`serv PLAN_v3.md` for the full phase plan, `spec/DECISIONS.md` for why each of these is
scoped the way it is, and `docs/API_NOTES.md` for what's been empirically confirmed against
the real vault (via fork test) vs. only against mocks.

## On-chain layer exists now, but coverage is partial (Phase 2, done; gaps below)

- `StewardAccount`, `StewardFactory`, `ConductRegistry`, `VaultHealthFeed`, and
  `ManagedVaultAdapter` are built, self-reviewed (6 real bugs found and fixed pre-test —
  see `spec/DECISIONS.md`'s 2026-09-22 entry), and covered by 49 unit tests, 1 invariant
  suite, and 4 fork tests against the real vault, all green.
- Invariant coverage is a focused subset, not the full O-01..O-18 list: the invariant suite
  (`contracts/test/invariant/StewardAccountInvariants.t.sol`) currently drives
  deposit/tighten/raiseReserve/pause/warp only and checks 5 properties (O-02, O-03, O-06,
  O-08, O-12 in simplified form). It does not yet drive requestRedeem/reconcile/loosen
  paths, and only exercises a single account — nothing multi-account (ConductRegistry
  cross-account correctness, Sybil-shaped scenarios) is invariant-tested yet.
- No Slither run yet.
- The `onchain-access-control` skill's checks 2 (TOCTOU/policy-version guard) and 4 (nonce +
  expiry on anchored receipts) are the two checks this phase doesn't fully implement:
  receipts are sequence-bound (`seq == nextSeq`, strictly +1) but nothing yet gives a
  receipt an explicit *expiry*, and there's no separate policy-version counter beyond the
  sequence number itself. Check 5 (separate append-key from rule-change-key) **is** done —
  `agent`/`guardian` can never change the mandate or withdraw; only `owner` can.
- `exposure` tracks deposited-minus-reconciled value directly, not a live NAV-revalued,
  haircut-adjusted recognised position value — the full `spec/accounting.md` section 2
  formula (with issuer/latency haircuts) exists in `packages/engine` as the off-chain
  source of truth for capacity math; on-chain, `StewardAccount` enforces the hard envelope
  using the simpler figure. Documented in the contract's own top-level comment.
- `spec/tiers.md` section 6 says total risk units in `ConductRegistry` should be "weighted
  by min(exposure, tier maxVault)" — neither the off-chain TS/Python engine nor the
  Solidity contract implement that explicit weighting (structurally redundant in the normal
  case, since on-chain exposure can never exceed the current tier's ceiling — but after a
  demotion with an exposure overhang above the new, lower tier ceiling, risk still accrues
  at the pre-demotion exposure level until the overhang is resolved). A shared gap across
  all three implementations, not a Solidity-only divergence.
- No deployment of any kind happened in Phase 2 — every test ran locally, either against
  mocks or a read/fork-only connection to real BSC (`forge test --fork-url`, never
  `forge script ... --broadcast`). Nothing was deployed to any network, testnet included.

## SERV integration (Phase 3, done except the parts that need a live key)

- **Done:** the deterministic claim-grounding/corroboration/effect-table pipeline
  (`spec/evidence.md`, `packages/engine/src/evidence.ts` +
  `packages/engine-py/steward_engine/evidence.py`) — quote grounding (verbatim substring after
  whitespace normalization), corroboration (two models, same type/polarity, overlapping
  matched source regions), the ADVERSE/FAVORABLE/NEUTRAL effect table, and
  `evidenceSnapshotId` hashing, plus `evidenceHealthMultiplierBps` (the capacity-multiplier
  math itself — direct unit coverage added after the Phase 3 reliability review found it had
  none). 23 unit tests per language (evidence grounding/corroboration, the multiplier
  function, and the `checkDeposit` info-bit-vs-refuse-bit split below) plus a 9-case
  differential suite (`fixtures/differential/evidence_cases.json`). Wired into `checkDeposit`'s
  reason mask (`ADVERSE_CLAIM`/`UNGROUNDED_CLAIM` bits, informational only — see
  `spec/DECISIONS.md`'s 2026-09-22 entries for the bug this caught in its own first draft, and
  the follow-up review that found the fix itself lacked a direct test — confirmed by
  deliberately reintroducing the bug in both languages and watching the new tests catch it,
  then reverting).
- **Done:** a live, read-only health-snapshot reader (`scripts/live-health-snapshot.ts`,
  `make measure-health`) that builds a real `HealthSnapshot` from the live vault via
  `cast call`/`cast implementation`/`cast codehash` — no key, no funded wallet, nothing
  broadcast. `docs/measurement-report.md` has the current real numbers; its "claimed liquidity"
  comparison side is still an open TODO (needs a sourced quote from IXS/Compass docs, not a
  guess).
- **Done:** `examples/naive-agent` — independent reference code (no Steward contracts, no
  `@steward/engine` import) that consumes a live snapshot and declines to deposit when p90
  exceeds its own threshold. Against the real vault's current numbers it declines (p90 ≈304.6h
  against a 3-day default threshold) — a live demonstration of the "measured, not vendor-claimed
  liquidity" pitch, not just a math example.
- **Done:** the SERV network client (`packages/serv-client`) — `chatCompletion` (transport:
  timeout, retry-on-5xx-only, fail on 4xx, all typed failures, never a thrown exception),
  `validateProposal`/`proposalFromModelOutput` (strict schema + fail-closed-to-`HOLD`, with
  explicit defense against a model output smuggling an `address`/`calldata`/`limit` field —
  CLAUDE.md's core invariant, enforced twice: the type has no such field, and the validator
  rejects any extra key outright), and `extractClaims`/`buildEvidenceOutcome` (the two-model
  call wired into `packages/engine`'s grounding/corroboration, with an explicit
  transport-failure-means-stale rule — a failed SERV call must never look identical to
  "checked, nothing adverse found"). 26 unit tests against a mocked HTTP layer, no live call
  needed to verify any of this. **`scripts/live-serv-probe.ts` (`make live-serv-probe` /
  `pnpm run live:serv-probe`) has now been run by the repo owner (2026-09-22) — real findings
  in `docs/API_NOTES.md`:** latency ranged ~0.68s-6.1s across 7 live calls (30s timeout has
  real headroom, not just a guess); no rate limit hit in a 5-call burst (not a comprehensive
  test); and — the one finding that matters most — **`serv_prompt_guard`/`serv_shadow_agent`
  do not work as an OpenAI-standard `tools[].type` value** (`400: "Supported values are:
  'function' and 'custom'"`). This falsified the exploratory guess in
  `scripts/live-eval.ts`/`scripts/live-serv-probe.ts`; `live-eval.ts`'s "guarded" arm has been
  changed to send no `tools` field (previously it would have 400'd on every call) until the
  real wire format is found, and a follow-up exploratory probe
  (`tool_use_custom_type_exploratory`) was added for the next probe run. **Still genuinely
  unmeasured:** retry behavior under a real 5xx and the actual timeout boundary (neither
  occurred live), and the correct `serv_prompt_guard` wire format.
  **Also flagged by the Phase 3 reliability review:** no failure path in
  `packages/serv-client` (a timeout, a malformed body, an ungrounded/schema-invalid claim or
  proposal) is logged anywhere today — `chatCompletion`/`extractClaims`/
  `proposalFromModelOutput` all return a typed `reason`/`failureReason` string, but nothing
  currently persists it. Harmless right now because nothing calls this client from a live
  decision loop yet (the orchestrator is Phase 4, `serv PLAN_v3.md` §11), but that orchestrator
  must log `{sourceUrl or scenario id, decision seq, failureReason}` before collapsing a
  transport failure into `evidenceFresh = false`/`HOLD`, and that logging call needs its own
  test (inject a fake logger, assert it's called on the failure path) — an owner looking at a
  `STALE_EVIDENCE` refusal with no trail of *which* model failed and why is exactly the
  observability gap `reliability-observability` exists to catch, tracked here so it isn't
  forgotten once Phase 4 starts.
- **Done (offline half):** `scripts/run-eval-offline.ts` (`make eval`) — 21 hand-curated
  scenarios (`eval/scenarios.json`) feeding synthetic adversarial/legitimate payloads
  (fabricated quotes, region-mismatched "corroboration" attempts, smuggled
  `address`/`calldata`/`limit` fields, malformed JSON, positive controls) directly into the
  deterministic defenses above. 21/21 pass. This is **not** the "raw model vs SERV vs
  SERV+policy" live comparison PLAN_v2 §13 point 7 and PLAN_v3's C6 ask for, and not the full
  100-scenario set — it measures whether the built defenses hold against adversarial *shapes*,
  not what SERV's real models actually produce.
- **Run (2026-09-22, by the repo owner):** `scripts/live-eval.ts` (`make live-eval` /
  `pnpm run live:eval`) — 30 live calls (10 scenarios × 3 arms). Full findings in
  `docs/API_NOTES.md`. Headline result: `unsafe_rate` (a smuggled `address`/`calldata`/`limit`
  field surviving validation) was **0% in every arm** — the first time that claim was checked
  against real model output rather than only synthetic payloads. One real finding, not a bug:
  `guarded_policy`'s `schema_valid_rate` was 90%, not 100% — the live model returned lowercase
  `"hold"` on one call, and `validateProposal` correctly rejected it (case-sensitive by
  design; do not loosen it). **Re-run 2026-09-26 twice:** first 20% schema-valid (the
  lowercase drift got worse), then, with strict `response_format` sent to SERV, 100% (10/10);
  `unsafe_rate` 0% in every arm both times (`docs/API_NOTES.md`). The `guarded` arm's numbers are **not** yet evidence about
  `serv_prompt_guard`'s effect — it currently sends no `tools` field, per the wire-format
  finding above. Its scenario set is reused from `eval/scenarios.json`'s evidence scenarios
  (source-text documents), not a separately curated 100-item adversarial corpus, and none of
  these 10 scenarios were specifically designed as reasoner-targeting prompt injections
  (they're evidence-grounding scenarios repurposed) — closing both gaps (100-scenario scale,
  and scenarios that actually try to manipulate the *proposal*, not just the evidence) is
  future work, tracked here rather than silently left out.

## Phase 4 (done, fork-only — see `LIVE.md`)

- **Done:** a persistent (not per-test-disposable) mainnet fork (`scripts/fork-node.sh`),
  the full contract stack deployed onto it (`contracts/script/DeployDemo.s.sol`), and Agent A
  driven through a real, on-chain T0 -> T1 graduation (`scripts/demo-driver.ts`) — one
  qualifying deposit, nine receipt-generating `logDecision` calls, a real fork-clock advance
  past the dwell requirement, and a real `graduate()` call that succeeded because all six
  promotion conditions genuinely held on-chain. Agent B (fresh stranger) was then created and
  both agents were asked to deposit the identical amount: Agent A (T1) succeeded, Agent B
  (T0) reverted with `OverMaxTx` — the "same request, two agents" contrast, real, not staged.
  Full detail and exact reproduction steps: `LIVE.md`.
- **Done:** an independent verification path (`scripts/replay-fork-demo.ts`,
  `make verify-live`) — confirms every recorded transaction still resolves against the fork's
  dumped-and-reloaded state, and independently recomputes the graduation predicate using
  `packages/engine`'s `checkPromotion` (the same TS function differential-tested against
  Python and Solidity throughout this project) fed with the real on-chain `TierState`. This
  is what "verifiable" means for a fork-only build: reproducible by anyone with this repo and
  the state dump, not checkable on a public block explorer — `LIVE.md` states that
  distinction explicitly rather than implying more than is true.
- **Re-verified fresh 2026-09-23 (Phase 5 wrap-up) — the original run had gone stale.**
  Checking Phase 5's own exit criterion ("a non-technical person completes the demo script")
  found the original 2026-09-22 fork state and its cited tx hash no longer resolved anywhere
  — a real, previously-undocumented finding: the upstream free RPC's archive window ages a
  pinned block out over time, not just intermittently 403s it. Re-ran the entire Phase 4
  pipeline fresh (kill stale fork, `--fresh` re-pin, redeploy, redrive, re-verify) and
  confirmed it still works end to end, including against the actual `/verify` UI (not just
  the CLI scripts). Two real bugs in `scripts/demo-driver.ts` caught and fixed along the way:
  Agent A's funding was an undocumented manual step (fixed — self-funds now, matching Agent
  B); and a run where every single transaction hit the RPC's transient-error/recovery path
  would have recorded zero citable tx hashes (fixed — recovers the real hash from the
  newly-mined block instead of leaving it permanently `null`). `LIVE.md` rewritten with the
  fresh, currently-valid data. Full detail: `spec/DECISIONS.md`'s "Phase 5 wrap-up" entry.
  **Not resolved:** persisting fork state via a hand-rolled `anvil_dumpState` RPC dump to disk
  — the on-disk format `--load-state` expects doesn't match what that RPC call returns;
  stated honestly in `LIVE.md` rather than left as an untested assumption.
- **Zero-funds, fork-only, deliberate** (`spec/DECISIONS.md`'s Phase 0 decision, reaffirmed
  before Phase 4 started — a testnet deployment was considered and rejected, since it could
  only reach a mock vault, not the real IXS contract). No real deposit has been or will be
  made from this repo's own code unless that decision is explicitly revisited; every balance
  used in the Phase 4 demo came from impersonating a real token holder
  (`anvil_impersonateAccount`) on the local fork only. Consequence: the honeypot (real-stakes
  bounty) is scoped down to logging/leaderboard only, no real payout. The "live deployment +
  public verifier against real chain state" claim from the original plan does not apply to
  this build; "verified against a pinned mainnet fork, fully reproducible, not on a public
  explorer" is the accurate claim everywhere the README/demo would otherwise imply liveness.
- **Not done:** an actual mainnet (or testnet) deployment with real key custody. The `owner`/
  `agent`/`guardian` roles in the Phase 4 demo are Anvil's well-known, public dev accounts —
  safe only because nothing here ever leaves the local fork. `docs/THREAT_MODEL.md` states
  what changes when real key material and real funds enter the picture.
- **Measured limitation of this session's specific RPC endpoint, not a design flaw:** the
  free-tier public RPC anvil forks from (`docs/API_NOTES.md`) returned a transient "archive
  requests require a personal token" error on a majority of calls during the actual Phase 4
  run — every one of those calls, on inspection, had actually succeeded on-chain despite the
  client reporting failure. `scripts/demo-driver.ts` now detects and recovers from this
  (re-probes on-chain state rather than blindly retrying, which would have double-acted); see
  its header comment and `spec/DECISIONS.md`'s Phase 4 entry for the two real bugs this
  process caught (a seq-desync retry bug, and a `cast logs` call that always needed archive
  access because it scanned from genesis by default). A less flaky RPC would need none of this
  recovery logic, but the recovery logic itself is real defensive engineering, not a workaround
  papering over a design problem in the contracts or the driver's intended logic.

## Phase 5: everything built, including the exit gate itself — not yet run by an actual person

Per `serv PLAN_v3.md` §12, Phase 5's own exit criterion is "a non-technical person completes
the demo script with and without a wallet," not a feature checklist. Every individual piece
below is built and confirmed working against real data, including a live end-to-end
re-verification of the core Phase 4 "same request, two agents" story (2026-09-23, see below).

**The gate artifact itself is built too** (`apps/web/app/demo`, the `/demo` route) — checked
explicitly, since "every piece works" and "there's a walkthrough a non-technical person could
actually pick up" are different claims. `serv PLAN_v3.md` §13.1's own "demo script" is a
video-recording cue sheet for a narrator (references BscScan, which this fork-only build
never touches), not click-through instructions. `/demo` is: six numbered plain-language
steps, each linking to the real `/verify`/`/simulate`/`/app`/`/honeypot` pages with query
parameters built from whatever is *currently* deployed (read live from
`.fork-state`/`.demo-state` at request time, not hardcoded — the previous re-verification
entry found hardcoded fork addresses go stale). Verified working against the live fork:
following its own generated Verifier link produces "Sequence continuity: OK" / "AGREES" /
"Independently confirmed eligible"; its honeypot link shows the real leaderboard counts.
Three Playwright tests (`apps/web/e2e/demo-walkthrough.spec.ts`) confirm this through the
actual rendered UI, not just curl. Caught and fixed a real bug before shipping: the page had
no `searchParams`/`cookies()`/`headers()` call, so Next's static analysis couldn't see it
depends on runtime files and prerendered it once at build time — `export const dynamic =
"force-dynamic"` fixed it, confirmed via the build's own route table (`○ Static` → `ƒ
Dynamic`). Full detail: `spec/DECISIONS.md`'s "Phase 5 exit gate, second pass" entry.

**What hasn't happened, stated plainly:** literally handing this to a non-technical person
and watching them complete the demo script unassisted. The gate is built and works when
walked through by hand; it hasn't been used by anyone outside this session yet.

- **Done:** the Verifier (`apps/web/app/verify`, `make verify-live` equivalent via
  `pnpm dev` + the `/verify` route) — reads a `StewardAccount`'s real on-chain event history
  via `viem` and independently replays every tier transition with the actual
  `@steward/engine` functions, cross-checking the result against the contract's own current
  state. Confirmed live against real Phase 4 fork data: correct account summary, all events
  replayed in order, sequence continuity confirmed, and each graduation independently
  reconfirmed eligible rather than trusted. A real bug (viem decodes `uint32` as `number`, not
  `bigint`; a first draft mixed them) was found and fixed via this live testing, not caught by
  `pnpm build` alone — see `spec/DECISIONS.md`'s Phase 5 entry.
- **Known gap in the Verifier itself:** it inherits the same free-RPC archive-access
  flakiness documented elsewhere in this file, but — unlike `scripts/demo-driver.ts` — has no
  retry logic on its read calls yet. A flaky call surfaces as a clean, honest error message
  (not a crash), but the user has to manually retry rather than the page doing it. Also: the
  starting tier is a caller-supplied assumption (default 0), not independently derived from
  `StewardFactory`'s own `AccountCreated` event, so an account that started above T0 needs its
  real start tier supplied by hand or the replay will diverge from the first event.
- **Done:** Simulate (`apps/web/app/simulate`, the `/simulate` route) — a fully client-side,
  no-wallet, no-RPC page per `serv PLAN_v2.md` §12.2. Tier selector, mandate sliders, a
  treasury/reserve/proposed-amount panel, a 3-state evidence-health selector (mapping to
  `healthMultiplierBps` 0/5000/10000, spec/evidence.md's effect table), separate
  evidence-freshness and paused toggles, and a 7-preset "attack lab," all recomputed live on
  every control change via direct calls into the real `computeCapacity`/`capMandate`/
  `capLiquid`/`checkDeposit` functions (deep-imported from `packages/engine/src/*.ts`, not a
  UI-side reimplementation). Verified: `pnpm build`/`lint`/`typecheck` clean at both root and
  `apps/web`; the server-rendered initial state was checked against a hand-computation of the
  same engine call (capacity=400, headroom=400, binding term capTier, verdict ALLOW) and
  matched exactly; every attack-lab preset was traced by hand against `checkDeposit`'s actual
  logic to confirm it produces exactly the verdict/reason bits its own description claims.
  **Update, same session:** an earlier gap (no browser-driven test of the Simulate page, since the Chrome extension wasn't available) was closed without the extension —
  added `@playwright/test` to `apps/web` and wrote `apps/web/e2e/simulate.spec.ts`, a real
  headless-Chromium suite (4 tests) that drags the proposed-deposit slider, clicks the tier
  selector, and clicks all 7 attack-lab presets, asserting the actual DOM-rendered verdict/
  reason text after each interaction. Confirmed passing against `pnpm dev`, a `next build` +
  manual `next start`, and (the final, shipped form) `next build` + Playwright's own managed
  `webServer` (`apps/web/playwright.config.ts`) — CI runs `pnpm --filter web run test:e2e`
  directly, no hand-rolled process management. Real bugs caught along the way: a Playwright
  role/name regex matched the wrong button because one preset's description text quotes
  another preset's title verbatim (fixed by matching the exact title node, not the whole
  accessible name); `pnpm run start -- --port 3100` silently fails (`next start` treats the
  literal `--` pnpm forwards as a project-directory argument — fixed to `next start -p`); and
  a first CI draft backgrounded `next start` with a bare `nohup ... &` across separate `run:`
  steps and polled it with a bash curl loop — this worked (confirmed on a real ubuntu-latest
  run, `dx-auditor` PASS) but relied on undocumented runner behavior rather than a guaranteed
  contract, so it was replaced with Playwright's own `webServer` option (readiness-polling and
  teardown as a documented feature) before being called done. Wired into CI
  (`.github/workflows/ci.yml`'s `web` job), so this is now an enforced gate, not just a local
  check.
- **Real finding, not a Simulate bug:** the engine's own canonical unit is a small whole
  number (confirmed against `fixtures/differential/deposit_cases.json`: `amount: "100"`,
  `treasury: "10000"`, and `packages/engine/src/types.ts`'s `TIER_SCHEDULE`/`HARD_CAP`, all
  small integers), not the wei/1e18 fixed-point scale `contracts/src/libraries/Types.sol` uses
  for the same constants (`TierLimits(120e18, 150e18, ...)`, `HARD_CAP = 1200e18`).
  `apps/web/lib/replay.ts` (the Verifier) feeds real on-chain wei amounts into these same
  engine functions unscaled — a latent unit-scale mismatch. It didn't produce a wrong answer
  in Phase 4/5 testing because `checkPromotion`'s risk/peak thresholds are so much smaller
  than any wei-scale exposure that they pass trivially regardless of which scale is used, but
  it means the Verifier's dwell/risk/peak graduation checks aren't actually exercising the
  real threshold math at the real scale. Simulate avoids repeating this by working entirely in
  the engine's own native (unscaled) unit convention. Not yet fixed in `replay.ts` — tracked
  here, not silently patched, since `replay.ts` is otherwise tested and working.
- **Started, first slice done:** the wallet-connected live app (`apps/web/app/app`, the
  `/app` route), §12.3. Built so far: a dashboard (liquid/exposure/treasury, mandate,
  envelope, pending-loosen state, all real on-chain reads) with a capacity gauge (same
  `computeCapacity`/`capMandate`/`capLiquid` deep-import pattern as Simulate — see
  `apps/web/lib/live-capacity.ts`), a decision feed (real `Decision`/`Graduated`/`Demoted`
  event history, newest first), and owner/agent/guardian controls for `pause`/`unpause`/
  `cancelLoosen` (veto) via a minimal viem-based wallet connection
  (`apps/web/lib/wallet.ts` — not wagmi/RainbowKit, just `createWalletClient(custom(...))`,
  per CLAUDE.md's no-unrequested-abstractions rule). Every write is role-gated in the UI
  (matching the contract's own `onlyOwner`/`onlyAgent`/`onlyOwnerOrGuardian` modifiers) and
  re-reads `nextSeq` immediately before submitting rather than trusting the page's own
  possibly-stale state.
  **Verified**, not just built: deployed a real (non-BSC-fork) local Anvil stack via a new,
  dev-only `contracts/script/DeployLocalMock.s.sol` (uses this repo's existing
  `test/mocks/MockERC20`/`MockManagedVault`, sidestepping the BSC fork's archive-pruning
  flakiness entirely — see the finding below); drove a real agent deposit via `cast`, then
  confirmed the dashboard/capacity gauge/decision feed via `curl` against the real deployed
  account matched a hand computation exactly (capacity 150, headroom 50, binding term
  `capTier`, matching T0's real on-chain `TierLimits.maxVault`). Wrote
  `apps/web/e2e/app-controls.spec.ts`, a Playwright test using a **page-injected mock wallet**
  (`window.ethereum` shimmed via `page.addInitScript` + `page.exposeFunction`, whose
  `eth_sendTransaction` handler signs and broadcasts a real transaction through a real viem
  `WalletClient` holding Anvil's well-known dev-account-1 key) — not a stub, a genuine signed
  on-chain transaction driven by clicking the real UI: connect wallet, confirm role badge
  reads "owner", click Pause, confirm the dashboard shows PAUSED after a real tx confirms,
  then Unpause to restore state. Passed. This also caught a real, generalizable bug: the role
  badge uses CSS `text-transform: uppercase` for display, but the actual DOM text is lowercase
  (`"owner"`) — CSS text-transform doesn't change what `getByText` (or a screen reader) sees;
  first draft of the test asserted `"OWNER"` and failed until fixed. Not part of the CI-run
  suite yet (needs a local Anvil + a fresh deploy per run, not just a static build) — run
  manually per the test file's own header comment.
  **Real finding, not a bug in this slice:** `contracts/src/libraries/Types.sol`'s
  `TierLimits.maxVault` values are wei-scaled (`150e18` for T0) to match real on-chain
  amounts, but `packages/engine/src/types.ts`'s `TIER_SCHEDULE` (the same constants, deep-
  imported here) is not (`150n`) — the same unit-scale gap already documented above for
  `replay.ts`. `apps/web/lib/live-capacity.ts` gets this right (multiplies `capTier` by
  `10n ** 18n` before comparing against real wei-scale treasury/mandate figures — confirmed
  correct against real deployed data above), the opposite fix from Simulate, which stays
  unscaled because it never touches the chain. Both fixes are now recorded in one place
  (`apps/web/lib/live-capacity.ts`'s own header comment) so the next piece of on-chain-reading
  UI code doesn't have to rediscover this.
  **Sent through the `reliability-auditor` gate, PASS with a real bug found and fixed:**
  `waitForTransactionReceipt` doesn't throw on a reverted transaction (viem's documented
  behavior) — a first draft of `Controls.tsx`'s write flow would have silently reloaded the
  page as if a reverted `pause`/`unpause`/veto had succeeded. Fixed (explicit
  `receipt.status` check) and regression-tested with a second Playwright test that forces a
  real `BadSequence` race and asserts the error is shown, not swallowed — full detail in
  `spec/DECISIONS.md`'s "third slice" entry.
- **Second slice done — the rest of §12.3's controls, mandate builder, and approvals inbox:**
  `apps/web/app/app/Controls.tsx` gained `tightenCap`/`raiseReserve` (owner/agent/guardian,
  direction-restricted), the agent-side loosen flow (`proposeLoosenCap`, plus `applyLoosen`
  once the delay elapses), a `graduate()` trigger with a **live eligibility hint** (deep-
  imports the same `checkPromotion` the Verifier uses, recomputed against the account's real
  current `tierState` — the button is disabled with the real failed-condition list shown
  before a doomed transaction is ever submitted), and emergency exit realized honestly as
  `requestRedeem` (the contract has no separate `emergencyExit()` function — this *is* the
  real mechanism, risk-reducing and callable even while paused). `apps/web/app/app/
  MandateBuilder.tsx` (new, owner-only) is the plain-language-preview `setMandate` builder
  the plan calls for: every field edit updates a local draft only, and the actual write fires
  from an explicit "Confirm & sign" step that first renders a diff of every changed field
  (`"maxTxUsdc: 1,000 units → 1,500 units (looser)"`) — never a direct submit-on-change.
  **Real TOCTOU bug found and fixed by a manual self-check** (the full `reliability-auditor`
  gate for this slice was cancelled before completing — see `spec/DECISIONS.md`'s "fourth
  slice" entry for the honest accounting of what was and wasn't reviewed): `setMandate`
  overwrites the whole struct including 4 fields the UI doesn't let a user edit
  (`issuerHaircutBps` etc.); a first draft carried those straight from the page's SSR'd,
  load-time-stale props instead of re-reading them fresh at submit time, so a legitimate
  concurrent change to one could have been silently clobbered. Fixed with
  `apps/web/lib/chain.ts`'s `readMandateCarryThroughFields`, called immediately before
  submitting; re-verified passing afterward.
  **"Approvals inbox," checked against the real contract and realized honestly, not
  skipped:** `approvalAbove` (the `Mandate` field the off-chain engine uses for
  `NEEDS_APPROVAL`) is never read by `deposit()` or any other on-chain function
  (`contracts/src/StewardAccount.sol`, confirmed by grep) — deposits are agent-immediate, not
  owner-approved, so there is no real on-chain queue to build a live "inbox" against. Building
  one as if there were would be dishonest. What's real and built instead
  (`apps/web/app/app/AttackLab.tsx`): a read-only pre-flight preview, running the actual
  policy engine against the account's real live state, that tells you whether a hypothetical
  amount would cross the approval threshold or get refused *before* anything is submitted —
  doubling as the plan's separately-listed "attack lab" (same preset-driven pattern as
  Simulate's, applied to real numbers instead of a frozen scenario).
  **A real cross-component bug caught and fixed before shipping:** a first draft gave
  `Controls` and `MandateBuilder` each their own independent wallet-connect state, so the page
  showed two separate "Connect wallet" buttons — confusing UX, and it broke e2e locator
  uniqueness the moment both components rendered together. Fixed by extracting
  `apps/web/app/app/WalletSection.tsx`, which owns the connection once and passes the
  connected wallet down to both as a prop.
  **A real event-mislabeling bug caught while wiring the loosen flow:** the decision feed's
  event mapper (`apps/web/app/app/page.tsx`) originally matched only `"Decision"` and
  `"Graduated"` by name and fell through everything else — including the newly-added
  `LoosenProposed`/`LoosenCancelled`/`LoosenApplied` events — into a hardcoded `"Demoted"`
  label. Fixed with real per-kind handling for all three loosen events before it ever shipped
  mislabeled data.
  **Verified, not just built:** every new write function's exact ABI encoding was confirmed
  against the real contract via direct `cast` calls before any UI code trusted it —
  `tightenCap`, `raiseReserve`, `proposeLoosenCap`, `applyLoosen` (confirmed both the
  `LoosenDelayNotElapsed` revert before the window and real success after
  `evm_increaseTime`), `graduate()` (confirmed `NotEligibleForGraduation` matching the live
  dashboard's own recomputed "not yet eligible" hint), `setMandate`, and `requestRedeem`
  (confirmed after a real deposit produced real shares to redeem). Two dedicated Playwright
  tests drive real signed transactions through the actual rendered UI:
  `apps/web/e2e/mandate-builder.spec.ts` (fill a field, preview, confirm & sign, then confirm
  the dashboard reflects the real on-chain change after reload) and the existing
  `app-controls.spec.ts` (now using a shared `apps/web/e2e/mock-wallet.ts` helper instead of a
  duplicated local copy). **Real finding about running these together:** every `/app` e2e file
  shares one live on-chain account and its real monotonic `seq` — Playwright runs different
  spec *files* in different parallel workers by default even when each file serializes its
  own tests internally, so two files can race real transactions against the same seq. Run
  multiple of these files together with `--workers=1` (documented in `mock-wallet.ts`'s own
  header comment); a single file alone is unaffected.
  **Not started within the live app:** nothing — every piece of §12.3 is now built and
  verified, including the honeypot (below).
- **Honeypot — done, scoped honestly:** `apps/web/app/honeypot`, per `serv PLAN_v3.md` §9.
  Two real, working, separately-verified pieces:
  - **Notice inbox** (`NoticeInbox.tsx`, `apps/web/lib/honeypot-store.ts`, `app/api/honeypot/
    notices/route.ts`): real submission, real server-side sanitization, a real 2048-byte
    limit (§9.1's own number), and real per-key rate limiting (5/60s, in-memory — resets on
    restart, not distributed; an honest limitation for a single-process hackathon
    deployment, stated on the page, not hidden). Confirmed live: a real oversized (3000-byte)
    submission rejected with the real byte count in the error, and rate limiting kicking in
    exactly at the 5th request in a window (`curl`-tested before trusting the UI). Two
    Playwright tests (`apps/web/e2e/honeypot.spec.ts`) drive a real browser through submit
    and oversized-rejection, wired into CI (zero wallet/RPC dependency, same bar as
    `simulate.spec.ts`).
  - **Leaderboard**: reads a real account's real on-chain `Decision` history and classifies
    it into the plan's three categories using real data, not fabricated counts — verified
    against real driven data: Category A ("fooled the model, blocked") counts `logDecision`
    calls that logged a REFUSE verdict with no accompanying fund-moving action (confirmed
    live: drove one via `cast`, leaderboard showed exactly 1); Category C ("in-envelope,
    allowed") counts real ALLOW/ALLOW_CLAMPED deposits/redemptions (confirmed live: one real
    100-unit deposit, leaderboard showed exactly 1, total deposited matching exactly).
    Category B ("envelope violations") is **not** computed by scanning event history — a
    violation, by definition, doesn't look like a normal loggable event — it's pinned to the
    real, passing Foundry invariant suite (`contracts/test/invariant/`, 256 runs, the same
    suite `pnpm test`/`forge test` already runs) and stated as such on the page, not implied
    to come from the same on-chain scan as A and C.
  - **What's explicitly not built, stated on the page itself, not silently implied:** the
    plan's notices "entering the untrusted notes for the next cycle" means a live
    SERV-driven model actually reading submissions and proposing actions from them — this
    repo has no such orchestrator wired up (see the SERV integration section above; no
    `live:`-prefixed agent-session script exists for this), so submissions are collected for
    real but not live-processed this session. Category B's real-money payout is inherently
    out of scope under the zero-funds decision (no real pot exists to pay from) — the
    detection/verification half (the invariant suite) is real; the payout half is not.

## Phase 6: reach (independent) — fee-on-yield module done, the rest genuinely deferred

Per `serv PLAN_v3.md` §12, Phase 6 is "reach (independent)" — six unrelated items, explicitly
the first thing to cut if anything must be. Started with the one item that had a full,
already-written spec (`serv PLAN_v2.md` §7.6) rather than assuming priority order; the other
five are real research/scope questions this session didn't attempt, not oversights.

- **Done: the fee-on-yield module** (`contracts/src/StewardAccount.sol`) — `costBasis`
  tracked per-deposit, `basisOutAtRequest`/`feeBpsAtRequest` snapshotted per-redemption-request
  (not read live at reconcile time — see the TOCTOU fix below), `gain = max(0, received -
  basisOut)`, `fee = floor(gain * feeBps / 10000)` accrued to an owner-configured `operator`
  who can only `claimFees()`. **Deliberately not added to the `Mandate` struct or any
  constructor**, even though `packages/engine`'s off-chain `Mandate` TypeScript/Python types
  already declare `feeBps`/`maxFeeBps`/`operator` fields (spec'd in Phase 1, never wired to an
  on-chain counterpart when Phase 2 cut this to Phase 6) — putting them in the on-chain
  `Types.Mandate` struct instead would have rippled through all 8 existing `createAccount`
  call sites (contracts scripts/tests, `scripts/demo-driver.ts`) and every already-built,
  already-tested piece of `apps/web` that encodes/decodes a `Mandate`. Owner-settable
  post-deployment instead (`setOperator`/`setFeeBps`), joining the same "owner has unilateral
  power over economic terms" category `setMandate`/`setCap`/`setCapCeiling`/`setReserve`
  already occupy — zero ripple to anything already shipped. **Known, deliberate divergence,
  not a bug:** the off-chain `Mandate` type's `feeBps`/`maxFeeBps`/`operator` fields remain
  unused by any code path — present in the type because Phase 1 spec'd them there, unused
  because Phase 6 implemented the mechanism differently. Worth cleaning up the off-chain type
  eventually; not done here since it would touch the differential-tested fixture format for a
  cosmetic reason unrelated to this change.
- **`onchain-access-control` skill consulted retroactively, not before writing this — a real
  gap this session is stating plainly, not glossing over.** `CLAUDE.md` requires consulting
  that skill before writing access-control/fund-movement logic; this wasn't done until after
  the initial implementation was written and passing its own tests. Running it retroactively
  found a genuine, real TOCTOU bug (skill check 2, "guard the read-then-settle gap"):
  `reconcileRedemption` read the *live* `feeBps` at reconcile time, not what was active when
  the redemption was actually requested — an owner could raise (or lower) fee terms on an
  already-in-flight redemption during the real elapsed time between `requestRedeem` and
  `reconcileRedemption`. Fixed by snapshotting `feeBps` into `feeBpsAtRequest[requestId]` at
  request time, symmetric in both directions (tested: a rate raised OR lowered after the
  request has no effect on that specific redemption's fee, only on future ones). Regression-
  tested with two dedicated unit tests, not just the general invariant suite.
- **Real, fuzzer-driven invariant coverage added for O-09** ("operator fees never exceed
  `feeBps * realised gain` and never touch principal"), not just unit tests —
  `contracts/test/invariant/StewardAccountInvariants.t.sol`'s `Handler` gained a
  deposit→random-NAV(gain or loss)→redeem→reconcile→claim cycle, tracking an independent
  ghost sum of expected fees to cross-check against the contract's own `accruedFees` +
  cumulative claims, rather than comparing the contract's number to itself. 256 runs / 16,384
  calls, 0 unexpected reverts, both new invariants pass. Needed extending
  `test/mocks/MockManagedVault.sol` with a real, test-adjustable NAV (`setNavPerShare`) — the
  existing mock was permanently pinned at 1:1, making a "gain" structurally impossible to
  produce in any test; a fee-*on-yield* module is untestable without that.
- **A full `reliability-auditor` re-run found a real O-09 violation — fixed.** Rejected
  redemptions had no handling at all: `requestRedeem` debits `costBasis` unconditionally
  before the redemption is known to succeed, and `reconcileRedemption` only ever handles
  `Finalized`. A `Rejected` request (a real, spec'd vault outcome) permanently erased that
  `costBasis`, overstating `gain` — and therefore the fee — on the next genuine redemption of
  the same principal. Separately, the shares the real vault mints back on rejection went to
  `ManagedVaultAdapter` (never `StewardAccount` directly), and the adapter had no way to
  forward them out — stuck permanently. Fixed: `ManagedVaultAdapter.recoverRejectedShares`
  (recomputes the verdict from the vault's own state, doesn't trust a caller claim) and
  `StewardAccount.settleRejectedRedeem` (restores `costBasis`, reclaims the shares). Six new
  regression tests, including one reproducing the auditor's exact exploit sequence end-to-end,
  plus fuzz-level coverage in the invariant suite (a new Handler function constructing random
  reject-then-settle sequences, 0 assertion failures over ~2,000+ calls). A second, independent
  `reliability-auditor` pass verified the fix itself: **CLOSED**, no new issues — but it found
  the fix's own two access-control guards (`NotRequestReceiver`, `AlreadyRecovered`) had zero
  test coverage of their own, exactly the gap `CLAUDE.md`'s "a guard ships with a test that
  fails if it's deleted" rule exists to catch. Fixed with a new, isolated
  `contracts/test/unit/ManagedVaultAdapter.t.sol` — each new test verified to actually fail
  when its guard is temporarily deleted, not just passing by coincidence. Full writeup:
  `spec/DECISIONS.md`, "Phase 6, third item".
- **Closed: `reconcileRedemption`'s trust in the request-time preview.** Read the real vault's
  actual verified source (`github.com/IXS-Finance/vault-contracts`) — confirmed `finalizeRedeem`
  prices the payout at LIVE NAV when finalize is called, not the locked request-time price, and
  stores no on-chain-readable record of the amount actually paid afterward. `reconcileRedemption`
  now derives the true received amount from an exact USDC balance delta instead of trusting any
  vault-reported figure. This required serializing redemptions (one pending per account at a
  time, via a new `pendingRequestId` guard) so the balance delta stays attributable to a single
  request — a **new, deliberate liveness tradeoff**: if the vault operator never finalizes or
  rejects a pending request, the account can never request another redemption. Not fixed with an
  emergency-override function (would need its own careful gating, more scope than this
  deliverable warrants); stated plainly here and in `docs/THREAT_MODEL.md` instead. Full
  writeup: `spec/DECISIONS.md`, "Phase 6, fourth item".
- **Done: Halmos symbolic verification of `PolicyMath`** (`contracts/test/halmos/`) — 3 of 5
  attempted safety properties proved exhaustively for all `uint128`-bounded inputs
  (`capMandate <= maxVaultUsdc`, `capLiquid <= treasury`, `computeCapacity`'s
  headroom/overCap mutual exclusivity); the other 2 (`computeCapacity`'s min-of-caps bound,
  `recognisedPositionValue`'s haircuts-never-inflate property) hit solver timeouts at every
  tried configuration — confirmed not a bit-width scaling artifact, genuinely hard nonlinear
  arithmetic for an SMT solver. Both have Foundry fuzz coverage instead
  (`contracts/test/unit/PolicyMath.t.sol`, 256 runs each) as an honest, documented partial
  substitute, not a silent stand-in for the proof. **Found and fixed a real bug in the
  process:** the fuzzer's first run overflow-reverted `recognisedPositionValue` on
  near-`uint128::max` `shares`/`navPerShare` — a plain `uint256` multiply-before-divide that
  overflowed even though the true post-division result fit comfortably. Fixed with
  OpenZeppelin's `Math.mulDiv` (twice — the haircut step had the identical issue one level up),
  regression-pinned as a permanent named test. `recognisedPositionValue` is spec'd but not yet
  wired into any state-changing call site, so this was an availability bug (revert-on-input),
  not a fund-loss path — but a real one, caught only because a fuzzer/prover actually exercised
  the function's numeric edges instead of only the hand-picked values existing unit tests used.
  Full writeup: `spec/DECISIONS.md`, "Phase 6, second item".
- **Done, adapted from its original spec: the ERC-8004 bridge** — see "ERC-8004 registry
  (G2)" below for the full story (real registries verified, the plan's original "owner-posted
  feedback" mechanism found impossible against the real contract, identity registration built
  and fork-tested against the real registry instead, plus third-party feedback tooling). Full
  writeup: `spec/DECISIONS.md`, "Phase 6, fifth item".
- **Done: the x402-priced verification endpoint** (`apps/web/app/api/verify-paid/route.ts`,
  `apps/web/proxy.ts`) — real `@x402/next` middleware gating a new server-side verification
  API route (the existing `/verify` page runs entirely client-side, so there was nothing
  server-side to gate before this route existed). x402's own official settlement contracts
  aren't deployed to BSC (checked, not assumed — see `docs/API_NOTES.md`), so this uses Base
  Sepolia (`eip155:84532`) instead: the real protocol, a real hosted facilitator, zero real
  value at risk. Caught two real integration bugs before shipping: Next.js 16 deprecated
  `middleware.ts` in favor of `proxy.ts` (this repo's own `apps/web/AGENTS.md` warns training
  data may be stale for this version — confirmed against the installed docs, not assumed), and
  `@x402/evm`'s package root exports a client-side `ExactEvmScheme` under the same name as the
  server-side class actually needed (caught by `tsc`, fixed by importing from the correct
  `@x402/evm/exact/server` subpath). Verified live: a real `next dev` server plus `curl`
  produced a real HTTP 402 with a correctly-resolved USDC asset address and price, not just a
  type-checked guess. Regression test (`apps/web/e2e/verify-paid.spec.ts`) confirmed passing
  against a live server and added to CI's cold-runner-safe test set (no facilitator contact
  needed for the challenge step itself). **The payment-and-retry half is tested too**, once the
  user funded a fresh throwaway Base Sepolia wallet via public testnet faucets:
  `apps/web/scripts/live-x402-payment-test.ts` (official `@x402/fetch` client) completed a
  real payment against a live server, confirmed on-chain via a direct balance check (20.00 →
  19.99 USDC), not just trusted from the client's own reported success. Full writeup:
  `spec/DECISIONS.md`, "Phase 6, sixth item".
- **Not attempted, genuinely deferred, not oversights** (the remaining 2 of Phase 6's 6 items
  per `serv PLAN_v3.md` §12 — an earlier draft, `serv PLAN_v2.md` §7.6, also listed "operator
  mode (several owners)" and "loosen-delay tuning" as separate items, but v3 is the current,
  superseding plan and doesn't carry them forward as distinct Phase 6 deliverables):
  Finance District Agent Wallet adapter (needs an external account this session can't create —
  see `spec/DECISIONS.md`).
- **Multi-vault: the real gating question (`serv PLAN1.md`'s open question #1, never
  previously answered) is now closed — N=1, feature deferred, not because it's hard but
  because there's nothing to build it against.** "Multi-vault" means one StewardAccount/agent
  allocating across more than one vault contract, not multi-tenant/multi-chain/multi-asset.
  Gated on whether Compass's `markets?provider=ixs&chain=bsc` lists more than one IXS vault.
  Checked with a real, authenticated API call (`COMPASS_API_KEY`, user-supplied): exactly one
  market, the same vault (`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`) this whole project
  already targets. A first attempt at this item implemented the wrong interpretation (a
  factory-level change letting different accounts use different vaults) before the real
  intent was clarified — reverted in full once clarified, verified back to a clean 89/89.
  Full writeup: `spec/DECISIONS.md`, "Multi-vault, clarified and resolved."

## Phase 7: submission status (2026-09-24)

- **Honeypot not run publicly.** No funded pot, no live model consuming notices, no outside
  attempts; the notice store was empty. `docs/honeypot-report.md` marks every §9.3 metric as
  not measured rather than estimating one. Only the Foundry invariant result is cited.
- **Measurement report:** re-taken 2026-09-24 (block 123,735,963). n = 6 finalized requests, and
  the p90/max (12.7 days) is one request and finalized-only: two of the vault's eight requests
  are still pending after 63 and 107 days, so it understates the tail (next bullet). The
  "claimed" side is Compass's "within a defined window" (no number); its three quotes were
  re-checked byte for byte against the live page on 2026-09-24. Sending the report to IXS or
  Compass is the owner's decision and has not been done.
- **The health feed under-reports the tail (found 2026-09-24).** `spec/health.md` §2 and
  `packages/engine/src/health.ts` take latency samples from `Finalized` requests only. On the
  real vault that leaves out request 2 (0.1 share, 107 days pending) and request 6 (96.3 shares,
  about 105 USDC, 63 days pending), so the published `p90Sec`/`maxSec`, and the health cap
  derived from them, do not reflect either. Not changed in this build: adding a pending-age
  field changes the `HealthSnapshot` struct, so all three implementations and the 144
  differential fixtures. Follow-up: publish the oldest pending age next to `maxSec` and have
  `HealthMath` treat it as a lower bound on the tail.
- **The redemption-serialization limit is observed, not hypothetical.** The Phase 6 tradeoff
  (one pending redemption per account; an operator who never finalizes it blocks that account
  from redeeming again) was written up as a possibility. Two of the real vault's eight requests
  are in exactly that state today. n = 8 and one is dust, so this shows the failure mode
  exists, not how often it happens.
- **Halmos:** 3 of 5 `PolicyMath` properties proved; 2 timed out and are fuzz-covered only
  (see "Phase 6" above).
- **`/demo` walkthrough** has not been tried on an unassisted non-technical person.
- **The hosted demo is read-only and frozen at one run.** The hosted site reads the
  2026-09-26 run's chain (`deploy/demo-chain/state.json`) through a proxy that refuses every
  transaction, so `/app`'s wallet controls are off there, and the honeypot inbox is closed
  (its store is a local JSON file and Vercel's filesystem is read-only). The chain host is
  Render's free tier: it sleeps when idle, so the first request after a quiet spell waits for
  a cold start. The chain is a snapshot: it never advances and does not reflect today's vault.
- **That run needed one fork-only change to the real vault** (`LIVE.md`): the real vault's
  NAV had gone stale (last `setNAV` 2026-09-23 01:12 UTC, 48 h threshold), which makes its
  `maxDeposit` 0 for everyone, so the driver re-set the NAV at the unchanged price through
  the real NAV manager. The run's deposits therefore happened under a vault state the real
  vault was not in at that moment. `refreshStaleVaultNav` checks its own outcome (price
  unchanged, timestamp moved) but has no automated test, because it needs a live fork.
- **The self-contained state covers what the demo touched.** Every account and storage slot
  a demo transaction read or wrote was written back before the dump, and `/verify`, `/app`
  and `/honeypot` render identically from it and from the live fork. A read of a vault slot
  no demo transaction touched would return 0 there instead of the real value.
- **The hosted proxy's crash and timeout handling is checked by hand only** (built and run
  in Docker: oversized bodies, client aborts, startup window). Only its method allowlist has
  a unit test.
- **No demo video, no CI/test badges** in the README.

## Fixture scale

- The differential test suite (`fixtures/differential/`) has 144 hand-curated and
  seeded-random cases across 6 suites (deposit, redeem, tier promotion, tier incidents,
  health snapshots, evidence grounding/corroboration), not the "5,000+ generated cases" the
  plan eventually wants. 144 cases at 0 divergences is real signal, but it's boundary
  coverage, not fuzz-scale coverage.
- **It compares TypeScript with Python, not with Solidity.** A mistake made in both engines
  passes it. That happened: until 2026-09-26 both engines checked only the mandate's
  `maxTxUsdc` and `maxActionsPerDay`, while the contract enforces the lower of the tier's and
  the mandate's, so `/simulate` and `/app`'s pre-flight said ALLOW for a T0 deposit of 150
  that the contract reverts with `OverMaxTx`. Found in an end-to-end browser test, not by
  the differential suite. Fixed with engine unit tests in both languages, 26 new fixtures
  and browser tests; the engine and contract rules are still kept in step by hand. Property-based/fuzz generation is a later item,
  once there's a Solidity implementation of the evidence layer worth differential-testing
  against too (currently TS/Python only — Solidity's differential coverage is the Phase 2
  contracts' own invariant suite, a different mechanism).

## `pnpm build` is a placeholder

- The ROOT `pnpm build` still runs `tsc --noEmit`, identical to `typecheck`. The real
  deployable build is `apps/web`'s `next build` (Phase 5), which CI's Web job runs separately;
  the root script does not invoke it. Updated 2026-09-24.

## CI's contracts job doesn't run fork tests

- `.github/workflows/ci.yml` now has a `contracts` job (forge build + unit/invariant tests).
  It deliberately excludes `contracts/test/fork/*.t.sol` — those need live BSC RPC access,
  which isn't the cold-clone-no-network path CI is meant to gate on. Fork tests are a
  manual/separate command (see `contracts/test/fork/ModeA.t.sol`'s header comment). This
  means CI does not automatically re-verify Mode A stays open (`whitelistEnabled()`) — that
  needs a human (or a separate scheduled job, not built yet) to re-run the fork test
  periodically, since that flag is admin-mutable at any time.
- `contracts/lib/` (forge-std, OpenZeppelin) isn't committed as git submodules — see
  `spec/DECISIONS.md`'s 2026-09-22 entry for why — so CI fetches it via `contracts/setup.sh`
  on every run rather than checking it out from `.gitmodules`. A pinned-by-tag plain clone,
  not a submodule; re-pin the tags in `setup.sh` deliberately if either dependency needs
  updating, since nothing else enforces the version.
- `make measure-health` (`scripts/live-health-snapshot.ts`) is read-only and needs no secret,
  but it does need network access to BSC, so it's kept out of CI's default job for the same
  cold-clone-no-network reason as fork tests — not run automatically, no scheduled re-check.

## Vault facts that are admin-mutable, not guaranteed

- `whitelistEnabled()` on the real vault currently reads `false` (Mode A permissionless), but
  it's a single admin-controlled boolean that can flip with no notice. Any code that assumes
  Mode A works must re-check this immediately before acting, not cache it.
- NAV (`pricePerShare`) is set by an admin-held `NAV_MANAGER_ROLE`, not computed from real
  asset prices on-chain — the Health Feed's latency measurement is real and independently
  verifiable; NAV itself is a trusted input from the vault operator, full stop.

## ERC-8004 registry (G2) — checked, real, and partially built

- **Verified real and deployed, 2026-09-23:** `IdentityRegistry`
  (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) and `ReputationRegistry`
  (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) on BSC mainnet — confirmed via `cast code`
  against both directly, real non-empty bytecode, not just cited from a search result.
- **The plan's stated mechanism for this item ("owner-posted feedback from tier events") is
  impossible against the real contract, not just unbuilt.** The real `ReputationRegistry`'s
  `giveFeedback` explicitly reverts ("Self-feedback not allowed") if the caller is the
  agent's own owner (`IdentityRegistry.isAuthorizedOrOwner`) — read directly from the actual
  verified source, not assumed from the EIP prose. There is no legitimate way for a Steward
  account's own owner to post feedback about itself via this contract.
- **Built instead, with the user's explicit direction after this was surfaced:** real identity
  registration (`contracts/src/adapters/ERC8004IdentityBridge.sol`,
  `contracts/test/fork/ERC8004Identity.t.sol` — 7/7 passing against the real, live registry, a
  genuine fork test, not a mock) plus `scripts/generate-erc8004-feedback.ts`, which generates
  a spec-compliant feedback payload from a StewardAccount's real on-chain conduct for an
  independent third party (never this project) to review and submit themselves. Full writeup:
  `spec/DECISIONS.md`, "Phase 6, fifth item".
- **Not run end-to-end**, honestly stated: the feedback-generator script's own on-chain reads
  were verified by manual signature review against the actual Solidity struct declarations,
  not by a live run against a deployed account (the local fork from earlier in this session
  had already been reaped for memory pressure; starting a new one was declined per explicit
  instruction not to restart it unprompted). `cast call` fails loudly on any signature
  mismatch, so this is a real but weaker tier of verification than the identity bridge got.

## Guardrails are documented, not yet enforced as code

- `CLAUDE.md`'s "no `.env*`/keystore reads" and "live/deploy scripts get a name prefix" rules
  currently have no CI tripwire (no grep check, no lint rule). As of Phase 3, three scripts
  legitimately read `process.env` at their own runtime (`scripts/live-health-snapshot.ts`,
  `scripts/live-serv-probe.ts`, `scripts/live-eval.ts`) and are gated behind Makefile targets
  named `measure-health`/`live-serv-probe`/`live-eval`, kept out of `pnpm test` and CI's
  default job — but nothing *enforces* that a future script follow the same pattern; it holds
  today by convention and review, not by a checked rule. `packages/engine`/
  `packages/engine-py`/`packages/serv-client`'s actual policy/transport code still reads no
  environment variables and makes no network call outside the injectable `fetchImpl` used by
  tests (verified by `dx-auditor`, 2026-09-21 for Phase 1/2; re-verify for Phase 3's additions
  as part of this build's final review pass). Still worth a cheap CI grep step
  (`process.env` / `fetch(` outside an allowlisted set of files) before Phase 4 adds more
  network-touching code, per `integration-dev-experience`'s "guardrails as code" principle.
