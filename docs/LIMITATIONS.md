# Limitations

What this build does not do, or does only partly. Current as of 2026-09-27. Measured
behaviour of every external system is in `docs/API_NOTES.md`; who is trusted with what is in
`docs/THREAT_MODEL.md`.

## Scope of the demo

- **No real funds, and nothing on mainnet.** A deliberate zero-funds build. The real-vault run
  is on a local fork of BSC (`LIVE.md`); balances there come from impersonating a public USDC
  holder. The hosted site reads that run's chain, frozen, through a read-only proxy.
- **The model does not drive the demo.** The agent's actions in the demo run were sent by a
  script (`scripts/demo-driver.ts`), not proposed live by a SERV model. The SERV client, the
  proposal validator and the evidence pipeline are built and tested, including against the
  live SERV model (`docs/API_NOTES.md`), but no orchestrator connects a live model to the contracts.
- **One fork-only change to the real vault.** On 2026-09-26 the real vault's NAV was stale
  (older than its 48 h threshold), which makes its `maxDeposit` 0 for everyone. The demo
  driver re-set the NAV at the unchanged price through the vault's real NAV manager, on the
  fork only (`LIVE.md`). The run's deposits happened under a vault state the real vault was
  not in at that moment. `refreshStaleVaultNav` checks its own result but has no automated
  test, because it needs a live fork.
- **The public testnet run uses a mock vault.** It shows the contracts' behaviour on a block
  explorer, not the real IXS vault, which is mainnet-only. Contract source is not verified on
  BscScan, so calls show as raw method IDs.
- **Honeypot not run.** No prize pot, no live model reading submitted notices, no public
  attempts. The inbox works locally (sanitised, 2 KB cap, rate-limited in memory) and is
  closed on the hosted site. Category B ("envelope violations: 0") comes from the Foundry
  invariant suite, not from attacks.
- **`/demo` has not been tried by an unassisted non-technical person.**

## Hosted site

- **Read-only and frozen.** The hosted demo chain (`deploy/demo-chain/state.json`) is one
  run's state; it never advances and does not reflect today's vault. Wallet controls on `/app`
  are off there, and the honeypot inbox is closed (its store is a local file; Vercel's
  filesystem is read-only).
- **Cold starts.** The chain runs on Render's free tier, which sleeps when idle; the first
  request after a quiet spell waits about a minute.
- **The self-contained state covers what the demo touched.** Every account and storage slot a
  demo transaction read or wrote was written into the state, and `/verify`, `/app` and
  `/honeypot` render identically from it and from the live fork. A read of a vault slot no
  demo transaction touched would return 0 there instead of the real value.
- **The read-only proxy's crash and timeout handling is checked by hand only** (in Docker:
  oversized bodies, client aborts, startup window). Its method allowlist has a unit test and
  a CI smoke test.

## Contracts

- **Unaudited.** No external audit and no Slither run.
- **Invariant coverage is partial.** Seven fuzzed invariants: total deposits and exposure
  never exceed the hard cap, the sequence never goes backwards, the tier stays in range, and
  two bounds on operator fees. The fuzzer drives deposit, tighten, reserve, pause/unpause,
  time, redeem (settled and rejected) and fee claims, on a single account. Other properties
  (capacity, guardian can only tighten) are unit-tested, not fuzzed; the loosen flow and
  anything multi-account (`ConductRegistry` across accounts, Sybil-shaped records) are not
  fuzzed.
- **Receipts have no expiry.** Every action is bound to a strictly increasing sequence number
  and a policy-input hash, but a receipt carries no expiry time and there is no separate
  policy-version counter.
- **Exposure is book value.** `StewardAccount` tracks deposited minus reconciled value, not a
  NAV-revalued, haircut-adjusted position; the full formula exists in the off-chain engine.
- **Risk units are not capped at the tier ceiling.** `spec/tiers.md` weights risk by
  `min(exposure, tier maxVault)`; none of the three implementations does. It only matters
  after a demotion that leaves exposure above the new ceiling.
- **One pending redemption per account.** Needed to attribute each payout exactly; if the
  vault operator never settles a request, that account cannot redeem again. There is no
  emergency override. Two of the real vault's eight requests were unsettled after 65 and 109
  days (read 2026-09-26), so the state exists on the real vault today.
- **Halmos: 3 of 5 `PolicyMath` properties proved.** The min-of-caps bound and the
  haircuts-never-inflate property timed out (180 s earlier; about 10 minutes with yices on
  2026-09-26) and are covered by fuzzing only. `bitwuzla` was not tried.
- **The fee-on-yield module is owner-set after deployment**, not part of the mandate; the
  off-chain `Mandate` type still carries unused `feeBps`/`maxFeeBps`/`operator` fields.

## Policy engine and verification

- **The differential suite compares TypeScript with Python, not with Solidity.** 144 cases,
  0 divergences, but a mistake made in both engines passes it. That happened once: both
  engines ignored the tier's per-deposit and daily limits until 2026-09-26 (found in a browser
  test; fixed, with tests in both languages). Engine and contract rules are kept in step by
  hand. 144 curated and seeded cases is boundary coverage, not fuzz scale.
- **The Verifier feeds on-chain wei amounts to the engine unscaled.** The engine's unit is
  whole tokens. The promotion thresholds are small enough that the replay still agrees, but
  its risk/peak checks are not exercising the real thresholds at the real scale.
- **The Verifier's reads are not retried**; a flaky RPC shows as an error the user retries.
  Its starting tier is an input (default T0), not derived from the account's creation event.

## Vault Health Feed

- **Latency counts settled requests only.** Requests still pending (two on the real vault,
  above) are left out, so the published p90/max, and the health cap derived from them,
  understate the tail. Fixing it changes the `HealthSnapshot` struct in all three
  implementations.
- **Small sample.** Eight requests in the vault's history, six settled.
- **Vault facts are admin-controlled.** `whitelistEnabled()` (currently false, which is what
  lets a contract deposit) and the NAV are set by the vault's admins and can change without
  notice; the NAV is a trusted input from the operator, not computed on-chain.

## SERV integration

- **`serv_prompt_guard` / `serv_shadow_agent` are not wired.** Their wire format is unknown:
  sending them as OpenAI `tools[].type` values returns a 400. The eval's "guarded" arm is
  therefore the same as the raw arm.
- **The live eval is small.** 10 scenarios × 3 arms, reused from the evidence scenarios, not a
  100-item corpus of attacks aimed at the proposal itself.
- **Model failure reasons are returned, not logged.** Every failure path returns a typed
  reason, but nothing persists it; a future orchestrator must log it before a failure
  becomes a HOLD.
- **Unmeasured live:** behaviour under a real 5xx, the real timeout boundary, and SERV
  rejecting `response_format`.

## Other integrations

- **One vault only.** Compass lists a single IXS vault on BSC (checked with an authenticated
  API call), so allocation across vaults was not built.
- **ERC-8004:** identity registration is built and fork-tested against the real registry. The
  registry rejects feedback from an agent's own owner, so reputation feedback is generated for
  an independent third party to submit; that generator has not been run end to end.
- **Finance District Agent Wallet adapter:** not built (needs an external account).

## Repo and CI

- **CI does not run fork tests or live reads.** Fork tests and `make measure-health` need
  BSC network access, so nothing re-checks automatically that the real vault still allows
  contract deposits.
- **Root `pnpm build` is `tsc --noEmit`**; the deployable build is `apps/web`'s `next build`,
  which CI's Web job runs.
- **`contracts/lib/` is a pinned plain clone** (`contracts/setup.sh`), not a git submodule.
- **Rules about secrets and live scripts are enforced by review, not by CI.** Live and deploy
  scripts carry `live:`/`deploy:` prefixes and are kept out of CI, but no CI check stops a new
  script from reading the environment or the network.
