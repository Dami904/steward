# Steward

**An AI agent can propose moving money, but can it prove what it was allowed to do, and can it earn more room over time instead of being handed it?**

Steward is an OpenServ SERV Hackathon Edition 01 submission (RWA Vaults track, partner IXS
Finance). An AI agent proposes deposit and redeem actions on IXS's real `ManagedVault` on BSC
(`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`). A deterministic policy engine, not the model,
decides what is allowed. The agent's limits are tiers it earns from a replayable on-chain
record of its own conduct, not constants an owner typed in. Vault liquidity is measured from
chain history, not taken from documentation.

**Unaudited. Fork-only: no real funds were spent and nothing was deployed to mainnet. Not
financial advice.** See [What is real and what is simulated](#what-is-real-and-what-is-simulated).

[Judge fast path](#judge-fast-path) · [Compared to](#compared-to) · [Real vs. simulated](#what-is-real-and-what-is-simulated) · [Limitations](#known-gaps) · [Run it](#run-it-locally)

## The invariant

The model's output can never itself move funds or raise a limit. It emits a typed proposal
only; it never receives a code path that can name an address, produce calldata, set a limit or
raise capacity. Every increase in capacity or tier traces to a deterministic predicate over
on-chain state (`spec/accounting.md`, `spec/tiers.md`). Tightening is immediate; loosening is
owner-gated or veto-windowed. Every state-changing action is bound to a receipt (sequence
number plus policy-input hash), and an unreceipted action reverts.

## Judge fast path

| What | Number (re-run 2026-09-26) |
|---|---|
| Foundry tests (contracts, no network) | 89 passed, 0 failed |
| Off-chain unit tests (TS engine 27, Python engine 27, reference consumer 6, SERV client 26, web 8, demo-chain proxy 3) | 97 passed |
| Differential cases, TS vs. Python engine | 144 of 144 identical |
| Offline adversarial eval (deterministic defenses vs. synthetic model outputs; no live model) | 21 of 21 scenarios pass |
| **Live SERV eval** (`pnpm run live:eval`: 10 adversarial scenarios × 3 arms, 30 real calls to `gpt-5.4-mini` via SERV) | **0% unsafe in every arm** (no address, calldata or limit ever got past validation); full-defense arm 10 of 10 schema-valid with strict `response_format`; latency 0.9–2.4 s. Details: `docs/API_NOTES.md` |
| Halmos symbolic proofs of `PolicyMath` | 3 of 5 properties proved; the other 2 timed out and are fuzz-covered instead |

Built 2026-09-21 to 2026-09-26 and first pushed as one commit, so git history is short; the
day-by-day record of what was decided, measured and fixed is `spec/DECISIONS.md`.

Try it, with no keys, wallet or network:

```bash
pnpm install && pip install -r packages/engine-py/requirements.txt && bash contracts/setup.sh
pnpm lint && pnpm typecheck && pnpm test
cd contracts && forge test --no-match-path "test/fork/*.t.sol"
cd ../apps/web && pnpm dev   # open /simulate: sliders + a 7-preset attack lab, same engine
```

Hosted: **https://steward-rwa.vercel.app** (start at `/demo`). Every page works there. The
on-chain pages read the demo run's chain, served read-only from
`https://steward-demo-chain.onrender.com` (`deploy/demo-chain/`: the run's self-contained
Anvil state behind a proxy that refuses transactions and cheat methods). Hosted differences:
wallet controls on `/app` are off (the chain is read-only), the honeypot inbox is closed, and
the chain host sleeps when idle, so the first load after a quiet spell can take about a
minute. To run the same chain locally with no fork or RPC key: `make demo-chain`, then
`cd apps/web && pnpm dev`.

## Core proof: two agents, one request

Run against a local fork of BNB Chain (`LIVE.md`, run of 2026-09-26). Agent A graduated T0
to T1 through real transactions on the real `StewardAccount` contracts wired to the real vault
address. A fresh Agent B was created, and both were asked to deposit the same amount. Agent A
succeeded and Agent B reverted. The real vault's NAV was stale that day (it blocks all
deposits when it is), so the run re-set it on the fork at the unchanged price; `LIVE.md` says
exactly how. The run's chain is published, so anyone can re-check it:

```bash
make demo-chain    # serves the run's chain locally on :8546, no fork or RPC key needed
# then open /verify from /demo in apps/web (pnpm dev), or use the hosted site
```

The web Verifier (`/verify`) does the same replay in the browser with the real
`@steward/engine`, and cross-checks each graduation against the contract's own state.

## Measured vs. claimed liquidity

`docs/measurement-report.md`, re-taken 2026-09-24 from the real vault's full request history
(method `REQUEST_FINALIZE_VIEW`). Of the 8 redemption requests ever made, 6 settled (p50 about
0.26 hours, slowest 12.7 days) and **2 are still pending after 63 and 107 days**. The
percentile counts only settled requests, so 12.7 days understates the tail. Compass's docs say
only that the operator settles "within a defined window" and give no number, so the report
states what was measured and does not claim the docs are wrong. n = 6 settled is small, and
one of the two pending requests is dust (0.1 share).

## Compared to

Each row below was read on 2026-09-24 from the project's own README, the vendor's docs, or
(for WAIaaS) its maintainer's write-up. That is a check of what they say they do, not an audit
of their code, and the search behind it was a handful of queries, not a survey.

| Project | What it does, per its own docs | What differs here |
|---|---|---|
| [Warden](https://github.com/AtmegaBuzz/warden) | 19 rules: per-transaction and daily/weekly caps, allowlists, cooldowns, anomaly scoring in an off-chain TypeScript engine; spending limits and recipient allowlists enforced on-chain through EIP-7702 (`PolicyDelegate.sol`); an audit log behind an MCP tool and dashboard. Limits are mostly static; a `rampUpPolicy` template raises them over time. | The agent's tier limits rise only when a predicate over the account's own on-chain exposure history holds, and fall on incidents; time alone never raises them (an owner can still loosen limits by hand). Verdicts and policy inputs are emitted on-chain and replayable without an operator's log. |
| [WAIaaS](https://github.com/waiaas/WAIaaS) `REPUTATION_THRESHOLD` | Blocks an agent whose ERC-8004 reputation score is below a threshold. Tiered thresholds map the score and the transaction size to INSTANT / NOTIFY / DELAY / APPROVAL handling. | The input here is the account's own conduct record, not other parties' feedback (the real ERC-8004 registry rejects self-feedback, so this repo only registers an identity). The output is the contract's own per-transaction, per-vault and tier limits, not an approval workflow. |
| [seedless-agent-wallet](https://github.com/francis-codex/seedless-agent-wallet) (Solana; one of many similar projects) | On-chain Anchor program: per-transaction limit, daily limit, cooldown, kill switch. The owner sets the limits with a `set-policy` command. | Same class of on-chain caps. Here the target is EVM and one RWA vault, limits are earned rather than owner-set, and there is a measured redemption-latency feed. |
| Coinbase CDP wallet policies (AgentKit's wallet layer; [docs](https://docs.cdp.coinbase.com/server-wallets/v2/using-the-wallet-api/policies/evm-policies)) | Policy rules with criteria such as `ethValue` limits and `evmAddress` allow/deny lists on `signEvmTransaction`, set per project or per account. | Those caps are operator-configured. Here the tier that sets the caps is computed from replayable history. This repo does not compete on key custody: the owner key is a plain key in this build. |
| NAV oracles (Chainlink-style feeds; RedStone Settle) | Publish what a share is worth. I found no public feed of measured per-vault redemption latency (limited search). | Health feed: how long redemption actually takes, recomputed from the vault's own request history. Settled requests only; see the caveat above. |

Not a moat. On-chain caps, allowlists, kill switches, audit trails and reputation-conditioned
access all exist in the projects above, and Warden already ships a template that raises limits
over time. What this repo adds is narrower: tier limits that rise only on a deterministic
predicate over replayable on-chain history and fall on incidents, plus a measured-liquidity
feed for one RWA vault. Novelty beyond that is unproven. The plan's original prior-art notes also named
"Phalnx" and an on-chain "agentshield"; neither could be found, so neither is listed.

## What is real and what is simulated

- **Real:** the contracts and their tests; the policy engine; every transaction in `LIVE.md`
  (executed on a local fork of live BSC state); the vault health measurement; the ERC-8004
  identity registration (fork-tested against the live registry); an x402 payment on Base
  Sepolia confirmed by an on-chain balance check.
- **Simulated / staged:** the balances. USDC on the fork came from impersonating a public
  holder with `anvil_impersonateAccount`, local only. Tier schedules in demos are
  demo-speed, not production-speed.
- **Not done:** a live model reading notices, a funded honeypot, any mainnet deployment.

## Known gaps

- **No public honeypot results.** The honeypot inbox and leaderboard are built, but the
  real-stakes run was not done: no pot, no live model, no outside attempts. See
  `docs/honeypot-report.md`; there are no fooled-rate or catch-rate numbers.
- **Fork-only.** Nothing can be checked on a block explorer; reproduction is by re-running.
- **Halmos:** 2 of 5 `PolicyMath` properties are not proved, only fuzzed.
- **Redemption liveness tradeoff:** one pending redemption per account. If the vault operator
  never finalizes or rejects it, that account cannot request another. No emergency override.
  This state exists on the real vault today: 2 of its 8 requests are unsettled after 63 and
  107 days.
- **Finance District adapter and multi-vault not built.** The first needs an external account;
  Compass lists one IXS vault, so the second has nothing to target.
- **ERC-8004 feedback is not self-postable.** The real registry rejects self-feedback, so the
  bridge does identity registration only; feedback needs an independent third party.
- **Small, settled-only measurement sample** (n = 6). The health feed this repo publishes
  counts only settled requests, so it under-reports the tail while two requests sit pending
  (`docs/LIMITATIONS.md`). The Compass quotes were re-checked byte for byte against the live
  page on 2026-09-24; the report has not been sent to IXS or Compass.
- **Not verified:** model reasoning quality, owner key security, Sybil resistance.
- **Non-technical walkthrough** (`/demo`) has not been tried on an unassisted person.

Full detail: `docs/LIMITATIONS.md`, `docs/THREAT_MODEL.md`, `spec/DECISIONS.md`.

## Attribution

Built with Claude Code (Claude) as a coding agent under human direction. Depends on IXS
Finance's `ManagedVault`, the Compass API, OpenServ SERV, ERC-8004 registries, x402
(`@x402/next`, `@x402/fetch`), OpenZeppelin, Foundry, Halmos, Next.js and Playwright.

## License

[MIT](LICENSE), copyright 2026 Dami904. The contracts' `SPDX-License-Identifier: MIT` headers
match.

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io) (version pinned via `packageManager` in `package.json`; `corepack
  enable` will resolve it automatically)
- Python 3.12+ with [pytest](https://pytest.org) installed
  (`pip install -r packages/engine-py/requirements.txt`) — the differential test harness
  (`scripts/diff-check.mjs`) shells out to `python` to run the Python engine's fixture
  runners alongside the TypeScript ones, so this is required even though most of the repo
  is TypeScript.
- [Foundry](https://getfoundry.sh) (`forge`/`anvil`/`cast`) for the `contracts/` package.
  `contracts/lib/` (forge-std, OpenZeppelin) isn't committed — run `bash contracts/setup.sh`
  once to fetch it (see `spec/DECISIONS.md` for why it's a plain clone, not a submodule).

No API keys, funded wallet, or network access are required to run the default test path.
This repo is on a deliberate zero-funds/fork-only path (`spec/DECISIONS.md`). A handful of
targets are explicitly manual and kept out of `pnpm test`/CI's default job because they touch
a live network: `make fork-test` and `make measure-health` need only `BSC_RPC_URL` (public,
non-secret — see `.env.example`) and read-only chain state, never broadcasting or spending
real funds; `make live-x402-payment-test` needs a funded Base Sepolia testnet key; `make live-serv-probe` and `make live-eval` additionally need a real
`SERV_API_KEY` and make real, billed calls to the SERV Reasoning API — see
`docs/LIMITATIONS.md`'s SERV integration section for exactly what each one measures.

## Run it locally

```bash
git clone https://github.com/Dami904/steward.git && cd steward
pnpm install
pip install -r packages/engine-py/requirements.txt
bash contracts/setup.sh

# Required checks (also what CI runs, see .github/workflows/ci.yml)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd contracts && forge build && forge test --no-match-path "test/fork/*.t.sol"

# Optional, needs network + BSC_RPC_URL — confirms Mode A against the real vault, spends
# nothing (see .env.example):
forge test --match-path "test/fork/*.t.sol" --fork-url $BSC_RPC_URL

# Optional, read-only, needs network + BSC_RPC_URL — live health snapshot and reference
# consumer against the real vault:
make measure-health
node examples/naive-agent/index.mjs

# Optional, needs SERV_API_KEY, makes real billed calls — see docs/LIMITATIONS.md:
make live-serv-probe
make live-eval

# Optional, sends real BSC testnet transactions (mock vault, free test BNB from a faucet) — the
# same two-agent demo, public on testnet.bscscan.com; see scripts/testnet-demo.ts:
make deploy-testnet-keys   # once; prints the deployer address to fund
make deploy-testnet-demo   # about 12 min, writes deploy/testnet/run.json

# Optional, Phase 4: real on-chain graduation demo on a persistent local fork — see LIVE.md
bash scripts/fork-node.sh --fresh   # separate terminal, or backgrounded
make deploy-demo
make demo-graduation
make verify-live

# Optional, Phase 5: the Verifier web UI — needs the fork from above still running
cd apps/web && pnpm dev   # then open /verify and paste a StewardAccount address

# Optional, Phase 5: Simulate — no fork, no wallet, no network needed at all
cd apps/web && pnpm dev   # then open /simulate

# Optional, Phase 5: e2e tests for Simulate (real headless Chromium, see apps/web/e2e/) —
# needs `npx playwright install chromium` once; run against a `pnpm dev` you already have up
# (adjust BASE_URL if Next picked a port other than 3000), or:
cd apps/web && pnpm build && pnpm start &  # background it, or use a second terminal
pnpm --filter web run test:e2e

# Optional, Phase 5: the live wallet-connected app — needs a real wallet extension (e.g.
# MetaMask) pointed at the fork above (add it as a custom network, chain id 56)
cd apps/web && pnpm dev   # then open /app, paste a StewardAccount address, connect your wallet

# Optional, Phase 5: e2e tests for /app's controls and mandate builder, against a throwaway
# local (non-forked) Anvil — sidesteps the BSC fork's archive-pruning issues entirely, see
# contracts/script/DeployLocalMock.s.sol's own header comment
anvil --port 8551 &
cd contracts && forge script script/DeployLocalMock.s.sol --rpc-url http://127.0.0.1:8551 --broadcast
# copy the printed `account:` address, then from apps/web (both files share one live account
# and its real seq counter — always run them together with --workers=1, see
# apps/web/e2e/mock-wallet.ts's own header comment):
LOCAL_STEWARD_ACCOUNT=<printed address> pnpm exec playwright test app-controls.spec.ts mandate-builder.spec.ts --workers=1

# Optional, Phase 5: the honeypot — no fork, no wallet needed for the notice inbox; pass
# address+rpc query params (same pattern as /verify and /app) to see the leaderboard
cd apps/web && pnpm dev   # then open /honeypot

# Optional, Phase 5: the actual demo walkthrough (the real exit-gate page) — needs the fork
# from step 1 above with the Phase 4 pipeline run on it (deploy + demo-driver.ts, see LIVE.md);
# reads real addresses/tx data live, builds every link itself
cd apps/web && pnpm dev   # then open /demo
```

`pnpm test` runs, in order: the TypeScript engine's unit tests, the Python engine's unit
tests, `examples/naive-agent`'s decision-logic tests, `packages/serv-client`'s tests (mocked
HTTP, no network), then the differential suite (144 fixture cases across 6 categories —
deposit, redeem, tier promotion, tier incidents, health snapshots, evidence
grounding/corroboration — asserting the TS and Python engines agree byte-for-byte; see
`spec/accounting.md` invariant P-08, `spec/health.md` invariant P-14b, and
`spec/evidence.md`'s P-15..P-17).

## Project layout

```text
spec/                                    Frozen specs (accounting, tiers, health, evidence) +
                                          DECISIONS.md
packages/engine/                         TypeScript policy engine (runs unbuilt via
                                          `node --experimental-strip-types`, typechecked
                                          separately via tsc --noEmit) — includes evidence.ts,
                                          the claim grounding/corroboration pipeline
packages/engine-py/                      Python mirror of the same engine
packages/serv-client/                    SERV network client: chat completions transport,
                                          strict-schema proposal validation (fail-closed to
                                          HOLD), two-model claim extraction
examples/naive-agent/                    Independent reference consumer of the health feed —
                                          no Steward contracts, no @steward/engine import
eval/scenarios.json                      Starter adversarial/defense scenario set
fixtures/differential/                   Shared JSON test vectors for both engines
scripts/                                 Fixture generators, the differential test runner, and
                                          the live/eval scripts below
scripts/live-health-snapshot.ts          Read-only live health snapshot (make measure-health)
scripts/live-serv-probe.ts               Measures SERV transport behavior (make live-serv-probe,
                                          needs SERV_API_KEY — not run by agent sessions)
scripts/run-eval-offline.ts              Offline eval harness (make eval), no network
scripts/live-eval.ts                     Live raw/guarded/guarded+policy comparison (make
                                          live-eval, needs SERV_API_KEY)
scripts/generate-erc8004-feedback.ts     Phase 6: generates a spec-compliant ERC-8004 feedback
                                          payload from a StewardAccount's real conduct, for an
                                          independent third party to submit (make
                                          generate-erc8004-feedback)
apps/web/proxy.ts                        Phase 6: x402 payment gate (Next.js 16's proxy.ts,
                                          not the deprecated middleware.ts) on the route below
apps/web/app/api/verify-paid/            Phase 6: x402-priced server-side verification API,
                                          reusing /verify's own lib/chain.ts + lib/replay.ts
apps/web/scripts/live-x402-payment-test.ts  Phase 6: real on-chain-settled x402 payment test
                                          against a live server (make live-x402-payment-test)
contracts/src/                           StewardAccount, StewardFactory, ConductRegistry,
                                          VaultHealthFeed, ManagedVaultAdapter,
                                          ERC8004IdentityBridge (Phase 6) + libraries
contracts/test/unit/                     88 unit tests, no network; with the invariant suite `forge test` reports 89 (includes
                                          FeeOnYield.t.sol, 19 tests, ManagedVaultAdapter.t.sol,
                                          4 tests, and PolicyMath.t.sol, 6 fuzz tests, all
                                          Phase 6)
contracts/test/invariant/                Foundry invariant suite, no network — 7 invariant
                                          checks incl. 2 for O-09 (fee-on-yield, Phase 6)
contracts/test/halmos/                   Halmos symbolic verification of PolicyMath, run
                                          separately (not part of `forge test`) — see
                                          docs/LIMITATIONS.md, "Phase 6" (Phase 6)
contracts/test/fork/                     Mode A verification against the real vault, and
                                          ERC-8004 identity registration against the real
                                          registry (Phase 6) — needs BSC_RPC_URL or a public
                                          RPC url, broadcasts nothing
contracts/script/DeployDemo.s.sol        Phase 4: deploys the full stack onto the persistent
                                          fork (make deploy-demo)
scripts/fork-node.sh                     Phase 4: persistent Anvil fork (make fork-node)
scripts/demo-driver.ts                   Phase 4: drives Agent A's real T0->T1 graduation and
                                          the two-agent contrast (make demo-graduation)
scripts/replay-fork-demo.ts              Phase 4: independent re-verification (make verify-live)
LIVE.md                                  Phase 4 writeup: what's real, what's simulated
apps/web/                                Phase 5: Next.js app. /verify (done) independently
                                          replays on-chain history via @steward/engine;
                                          /simulate (done) is a no-wallet, client-side scenario
                                          simulator running the same engine live in-browser;
                                          /app (done, §12.3) is the wallet-connected live
                                          dashboard + capacity gauge + decision feed + every
                                          owner/agent/guardian control (pause/unpause/veto,
                                          tighten/raise, loosen propose/apply, graduate,
                                          emergency exit) + a mandate builder with a
                                          plain-language preview + a live attack-lab/approvals
                                          preview; /honeypot (done, §9) is a real notice inbox
                                          plus a leaderboard reading real on-chain decision
                                          history, scoped to the zero-funds decision; /demo
                                          (done, the actual Phase 5 exit-gate page) is a
                                          plain-language walkthrough with real, live-read links
                                          to all of the above — see spec/DECISIONS.md's "exit
                                          gate, second pass" entry
apps/web/e2e/                            Playwright suite. simulate.spec.ts,
                                          honeypot.spec.ts, and verify-paid.spec.ts (Phase 6 —
                                          CI-wired, no network/wallet needed) drive
                                          /simulate's sliders/buttons, /honeypot's notice
                                          inbox, and the real x402 402-challenge response
                                          through a real browser/HTTP client; app-controls.spec.ts,
                                          mandate-builder.spec.ts, and demo-walkthrough.spec.ts
                                          (manual — need a local Anvil deploy or real Phase 4
                                          demo data respectively, see mock-wallet.ts's/LIVE.md's
                                          own instructions; app-controls + mandate-builder run
                                          together with --workers=1) drive /app's wallet-connect,
                                          controls, and mandate builder through real signed
                                          transactions, and /demo's own generated links through
                                          to a real independently-confirmed graduation
contracts/script/DeployLocalMock.s.sol   Dev-only: deploys the full contract stack (this
                                          repo's own test/mocks/, not the real BSC vault) onto
                                          a plain local Anvil, for testing apps/web/app/app
                                          without the BSC fork's archive-pruning flakiness —
                                          not referenced by any `make` target or CI
docs/API_NOTES.md                        Measured behavior of every external dependency
docs/LIMITATIONS.md                      What's explicitly not handled yet
docs/THREAT_MODEL.md                     Trust assumptions, current and planned
docs/measurement-report.md               Measured vault liquidity vs. claimed (Phase 3, claimed
                                          side sourced in Phase 7)
docs/honeypot-report.md                  Phase 7: honest status of the honeypot (not run
                                          publicly; no attempt metrics exist)
```

## Further reading

- `spec/DECISIONS.md` — Phase 0 on-chain verification findings against the real vault, and
  the zero-funds build decision.
- `docs/LIMITATIONS.md`, `docs/THREAT_MODEL.md` — honesty docs, kept current.
