# Repo instructions for Claude Code

Fill in the Mission section per project. Everything below applies to every
project you drop this into.

## Mission

Steward: an OpenServ SERV Hackathon Edition 01 (RWA Vaults track, partner IXS
Finance) submission. An AI agent proposes deposit/redeem actions on IXS's real
`ManagedVault` (BSC, `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`); a
deterministic policy engine, not the model, decides what's actually allowed,
and authority (tier limits) is earned from a replayable on-chain conduct
record rather than configured as a constant. The invariant that must never
break: **the model's output can never itself move funds or raise a limit** —
every increase in capacity or tier must trace back to a deterministic
predicate over on-chain state (see `spec/accounting.md`, `spec/tiers.md`),
never to LLM text. See `serv PLAN_v3.md` for the full plan and
`spec/DECISIONS.md` for Phase 0 verification findings and the zero-funds
build decision.

## Source of truth, in order
1. Behavior you've actually reproduced (a script you ran, a response you
   logged) — not behavior you assume an API has.
2. Current official docs for any third-party service this repo depends on.
3. This repo's own tests and deployed contract source.
4. This file and any PRD/spec doc.
5. Model output / assumptions — lowest priority, must be checked against 1-4
   before shipping.

## Non-negotiable invariants
- The model never receives a code path that can name an address, produce
  calldata, set a limit, or raise capacity — it emits a typed proposal only.
- Every capacity/tier increase traces to a deterministic on-chain predicate,
  never to model text or an uncorroborated favorable evidence claim.
- Tightening (by the agent, guardian, or the health feed) is immediate and
  requires no approval; loosening is owner-gated or veto-windowed.
- Every state-changing action is bound to a receipt (sequence number +
  policyInput hash); an unreceipted action must revert.
- A guard that exists to prevent fund loss ships with a test that fails if
  the guard is deleted.

## Engineering rules
- Before integrating any external API that moves money or state, spend real
  time (or delegate to a subagent) mapping its failure modes: what does a
  timeout mean, is a 2xx synchronous or just "accepted", what's the actual
  idempotency guarantee. Write it down in `docs/API_NOTES.md` before writing
  the client.
- Use pnpm. Commit `pnpm-lock.yaml`. Never mix in a `package-lock.json` or
  `yarn.lock`.
- Keep TypeScript strict. Do not suppress type, lint, or test failures to
  get something green.
- Write or update a failing test before changing behavior, not after.
- Any script that needs a funded wallet, a live API key, or talks to
  mainnet gets a name prefix (`live:`, `deploy:`) so it's never accidentally
  run in CI or by a reviewer cloning the repo cold. (Project note: this repo
  is on the zero-funds/fork-only path per `spec/DECISIONS.md` — no `live:`
  scripts are expected to exist unless that decision is revisited.)
- Don't read `.env*`, keystores, or secret directories. Don't deploy to
  mainnet from an agent session.
- Before writing any access-control, permission, policy-gate, or
  proof/receipt-anchoring logic (on-chain or off-chain), consult the
  `onchain-access-control` skill first.

## Required checks
Run the real package scripts once scaffolded. Intended gate list:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
Wire all four into CI on every push and PR, not just the test step. A CI
that only runs `contracts:test` is not testing the app that ships it.

## Durable docs
Create and keep these current — they cost an afternoon and are the
difference between a project that looks finished and one that just looks
demoed:
- `docs/API_NOTES.md` — measured behavior of every external API this repo
  depends on for execution.
- `docs/LIMITATIONS.md` — what's explicitly NOT handled yet. Say it plainly;
  an honest limitations doc reads as more credible than silence, not less.
- `docs/THREAT_MODEL.md` — who's trusted, what happens if each key/wallet
  in the system is compromised.

## Review gates
After implementing a change, before calling it done, run the relevant
subagent:
- reliability/error-handling/retry/logging changes: `reliability-auditor`
- CI, scripts, packaging, repo structure, onboarding changes: `dx-auditor`

A task is not done until its subagent returns PASS.
