# Honeypot report (`serv PLAN_v3.md` §9.3)

**Status: the public, real-stakes honeypot was not run. No outside attempts have been
recorded, and this report does not contain results it doesn't have.** The plan's §9.3 asks for
attempts, unique submitters, model-level fooled rate, prompt-guard catch rate, envelope
violations, maximum in-envelope loss and an incident timeline. Below, each is marked as
measured, not measured, or not applicable, with the reason.

## Why it wasn't run as specified

- **No real pot.** `spec/DECISIONS.md` ("Live deployment -> fork-only") put the whole build on a
  local mainnet fork with zero real funds. §9.1's funded StewardAccount (about $25) therefore
  doesn't exist, and no real payout is possible.
- **No live model reading notices.** §9.1 says notices enter "the untrusted notes for the next
  cycle". No orchestrator that feeds submitted notices to a live SERV agent is wired up (no
  `live:`-prefixed agent-session script exists). Submissions are collected but nothing consumes
  them.
- **No public deployment window.** The inbox has never been exposed to the public. The local
  notice store (`apps/web/.honeypot-data`) was checked on 2026-09-24 and is empty.

## What exists and works (real, tested)

- **Notice inbox** (`apps/web/app/honeypot`, `apps/web/lib/honeypot-store.ts`,
  `apps/web/app/api/honeypot/notices/route.ts`): server-side sanitization, a 2048-byte cap, and
  a 5-requests-per-60-seconds per-key rate limit (in-memory, resets on restart, single
  process). CI-tested by `apps/web/e2e/honeypot.spec.ts`.
- **Leaderboard**: reads a real account's on-chain `Decision` history and classifies it into
  categories A and C from real data.

## §9.3 metrics, one by one

| Metric | Result |
|---|---|
| Attempts | **Not measured.** 0 recorded; the inbox was never public. |
| Unique submitters | **Not measured.** |
| Model-level fooled rate | **Not measured.** No live model consumed any notice. |
| Prompt-guard catch rate | **Not measured.** Same reason. The offline eval harness (`pnpm eval`, run 2026-09-24: 21 of 21 scenarios pass) feeds synthetic model outputs to the evidence-grounding and proposal-validation defenses. That shows those deterministic gates hold on a fixed adversarial set; it is a different, weaker claim than a public catch rate against a live model. |
| Envelope violations (Category B) | **0 found by the invariant suite**, not by public attackers: `contracts/test/invariant/`, 256 runs per invariant. This shows the contract-level invariants held under the fuzzer's random call sequences. It is not evidence of resistance to a motivated human. |
| Maximum in-envelope loss (Category C) | **Bounded by construction, not observed.** It is at most the tier cap of the account (T0/T1 limits in the mandate), because the policy engine and contract clamp deposits to it. No loss event occurred. |
| Incident timeline | **None.** No incidents, because nothing was exposed. |
| Pot drained by a real bug | **N/A**, no pot. |

## What this does and doesn't support

Supported: the envelope invariants hold under fuzzing; the notice-handling front door enforces
its size and rate limits; the in-envelope worst case is capped by the tier schedule.

Not supported: any claim about how the agent behaves against adversarial human input in the
wild, any "N attempts, 0 fooled" figure, or any real-money bounty. Do not quote this report as
evidence of those.

## To make it real later

1. Fund a dedicated StewardAccount with an amount you accept losing, on a real chain
   (this reverses the zero-funds decision, so record that in `spec/DECISIONS.md` first).
2. Wire a `live:` agent-session script that feeds sanitized notices to the SERV agent as
   untrusted notes.
3. Expose `/honeypot` publicly for the judging window, persist notices somewhere that survives
   restarts, then fill the table above from real logs.
