# Reproduction commands for the claims in README.md.
# Targets are filled in as each phase lands; unimplemented ones say so rather than
# silently no-op or fail on a missing tool.

.PHONY: test-differential test-engine test-invariants test-contracts test-halmos fork-test test-evidence eval verify-live demo-graduation measure-health live-serv-probe live-eval fork-node deploy-demo generate-erc8004-feedback live-x402-payment-test demo-chain deploy-testnet-keys deploy-testnet-demo

test-differential:
	node scripts/diff-check.mjs

test-engine:
	node --experimental-strip-types --test packages/engine/test/*.test.ts
	python -m pytest packages/engine-py/tests -q

# Unit tests only (contracts/test/unit/*.t.sol) — no network. Requires contracts/lib/, see
# contracts/setup.sh.
test-contracts:
	cd contracts && forge test --match-path "test/unit/*.t.sol"

# Invariant tests only (contracts/test/invariant/*.t.sol) — no network. See
# docs/LIMITATIONS.md for what's covered (O-02/O-03/O-06/O-08/O-12 in simplified form, not
# the full O-01..O-18 list yet).
test-invariants:
	cd contracts && forge test --match-path "test/invariant/*.t.sol"

# Symbolic verification of contracts/src/libraries/PolicyMath.sol — no network, but needs
# `pip install halmos` first (not a repo dependency, deliberately not wired into CI: 3 of 5
# properties prove exhaustively in seconds, the other 2 hit genuine SMT solver timeouts and
# take 4-6 minutes to time out — see docs/LIMITATIONS.md, "Phase 6"). The same 5 properties
# also have Foundry fuzz coverage in test-contracts (contracts/test/unit/PolicyMath.t.sol),
# which IS part of the default suite and CI.
test-halmos:
	cd contracts && halmos --contract PolicyMathSymbolicTest --root .

# Needs BSC_RPC_URL (see .env.example) and network access — deliberately not part of
# test-contracts/test-invariants or CI's default path (see .github/workflows/ci.yml).
# Confirms Mode A against the real, live vault via a local state fork; broadcasts nothing.
# Also covers ERC-8004 identity registration (test/fork/ERC8004Identity.t.sol, matched by the
# same glob) against the real, deployed registry on BSC mainnet — see spec/DECISIONS.md,
# "Phase 6, fifth item".
fork-test:
	cd contracts && forge test --match-path "test/fork/*.t.sol" --fork-url $${BSC_RPC_URL}

# Read-only: reads a StewardAccount's real tier/conduct state via `cast call` and prints a
# spec-compliant ERC-8004 feedback payload for an independent third party to review and
# submit themselves (this project can never legitimately submit it — see
# scripts/generate-erc8004-feedback.ts's own header and spec/DECISIONS.md, "Phase 6, fifth
# item"). No key or funded wallet needed. Usage: make generate-erc8004-feedback ACCOUNT=0x...
# AGENT_ID=1 [RPC_URL=...]
generate-erc8004-feedback:
	node --experimental-strip-types scripts/generate-erc8004-feedback.ts --account $(ACCOUNT) --agent-id $(AGENT_ID) $(if $(RPC_URL),--rpc-url $(RPC_URL),)

# Needs a real funded (if valueless) Base Sepolia testnet wallet — X402_TEST_WALLET_PRIVATE_KEY
# (.env.example) — and a running apps/web server (`pnpm --filter web dev` or `next start`).
# Makes a real, on-chain-settled x402 payment against /api/verify-paid using the official
# @x402/fetch client; see apps/web/scripts/live-x402-payment-test.ts's own header and
# spec/DECISIONS.md's x402 entry. Never run in CI. Usage: make live-x402-payment-test
# [BASE_URL=http://localhost:3000]
live-x402-payment-test:
	node --env-file=.env --experimental-strip-types apps/web/scripts/live-x402-payment-test.ts $(if $(BASE_URL),--base-url $(BASE_URL),)

# Public BSC testnet (chain 97) run of the "same request, two agents" demo against this repo's
# mock vault (the real IXS vault is mainnet-only; its run is the hosted fork, LIVE.md). Sends
# real testnet transactions from throwaway keys in .testnet/keys.json (gitignored). Never run
# in CI. See scripts/testnet-demo.ts's header.
deploy-testnet-keys:
	node --experimental-strip-types scripts/testnet-demo.ts keys

deploy-testnet-demo:
	node --experimental-strip-types scripts/testnet-demo.ts run

# Read-only: cast call/implementation/codehash against live BSC mainnet, no key or funded
# wallet, nothing broadcast. Builds one real HealthSnapshot via the same buildRequestFinalize-
# Snapshot spec/health.md logic the differential suite covers offline. Pass WRITE=1 to also
# write docs/measurement-report.json. Kept out of the default CI job (needs network), same
# treatment as fork-test.
measure-health:
	node --experimental-strip-types scripts/live-health-snapshot.ts $(if $(WRITE),--write,)

# Deterministic claim grounding/corroboration/effect-table logic only (spec/evidence.md) —
# no network, no SERV API key. Already covered by `pnpm test`; this is a convenience subset.
# Does NOT test the SERV client itself (chat completions, serv_prompt_guard/shadow_agent) —
# that's unbuilt; see docs/API_NOTES.md and docs/LIMITATIONS.md.
test-evidence:
	node --experimental-strip-types --test packages/engine/test/evidence.test.ts
	python -m pytest packages/engine-py/tests/test_evidence.py -q

# Needs SERV_API_KEY (see .env.example) and makes real, billed calls to the SERV Reasoning
# API — never run in CI, never run by the agent session (CLAUDE.md: no .env reads). Run this
# yourself to fill the "not yet measured" gaps in docs/API_NOTES.md's SERV section (timeout,
# retry/idempotency, serv_prompt_guard/serv_shadow_agent tool behavior, rate limits, cost) —
# see scripts/live-serv-probe.ts's header for exactly what it measures and why it matters
# before packages/serv-client's transport assumptions are trusted.
live-serv-probe:
	node --env-file-if-exists=.env --experimental-strip-types scripts/live-serv-probe.ts

# Deterministic half of the eval harness (eval/scenarios.json's synthetic adversarial
# payloads against the defenses this repo already built) — no network, no key.
eval:
	node --experimental-strip-types scripts/run-eval-offline.ts

# Live half: raw vs guarded vs guarded+policy against real SERV calls on the same scenario
# documents. Needs SERV_API_KEY, makes real billed calls — never in CI, never run by the
# agent session. See scripts/live-eval.ts's header.
live-eval:
	node --env-file-if-exists=.env --experimental-strip-types scripts/live-eval.ts

# Phase 4 (LIVE.md): persistent mainnet fork, real (fork-local) transactions, zero real
# funds — spec/DECISIONS.md's "Live deployment -> fork-only" decision. Run these three in
# order for a fresh demo: fork-node (foreground, run in its own terminal or backgrounded),
# then deploy-demo, then demo-graduation. See LIVE.md for the full walkthrough including the
# funding step (whale impersonation, not scriptable as a single make target since it needs
# the freshly-deployed account address).
fork-node:
	bash scripts/fork-node.sh $(if $(FRESH),--fresh,)

deploy-demo:
	cd contracts && forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:$${FORK_PORT:-8546} --broadcast

# Drives Agent A through a real T0->T1 graduation and the "same request, two agents" contrast
# against the running fork (see fork-node/deploy-demo above, and LIVE.md's funding step).
demo-graduation:
	node --experimental-strip-types scripts/demo-driver.ts

verify-live:
	node --experimental-strip-types scripts/replay-fork-demo.ts

# The committed demo run (deploy/demo-chain/state.json), served read-only on 127.0.0.1:8546
# with no fork and no upstream RPC: the same chain the hosted site reads. Open
# apps/web (pnpm dev) and follow /demo.
demo-chain:
	cd deploy/demo-chain && PORT=${FORK_PORT:-8546} node proxy.mjs

