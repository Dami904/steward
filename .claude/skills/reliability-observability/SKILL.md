---
name: reliability-observability
description: Use this whenever writing or changing code that calls an external API, handles a webhook, moves money, executes a transaction, or runs as a background/scheduled job. Also use whenever the user asks to "make this reliable," "add error handling," "add logging/observability," "handle failures," "add retries," or "make this production-ready." Applies to any client that talks to a third-party execution/payment API (KeeperHub, x402, a chain RPC, a webhook target) — always consult this before writing that client, not after it breaks.
---

# Reliability & Observability

The goal: nothing this code does should ever be a mystery six hours later.
Every external call has a known failure mode, every failure is logged
somewhere a human can find it, and nothing that touches money can silently
run twice or silently vanish.

## Before writing any external API client

Don't guess at an API's behavior. Spend 30-60 minutes establishing, for
real, against the actual API (or its docs if you can't test live yet):

- Is a 2xx response synchronous ("this happened") or just an
  acknowledgment ("this was accepted, check back later")?
- What does a timeout actually mean — did the request never arrive, or did
  it arrive and the response got lost?
- Is there a real idempotency mechanism, and is it idempotent on the
  *semantic* action (won't double-pay) or only on the *transport* (won't
  double-log the same HTTP call)? These are not the same guarantee.
- What's returned on a retry of an already-completed action — an error, the
  original result, or a new attempt?

Write the answers down in `docs/API_NOTES.md`. This becomes your design doc
and it's the first thing `reliability-auditor` will ask for.

## The core rule: three states, not two

Don't model an external call as succeeded/failed. Model it as:
- **CONFIRMED** — you have positive proof the action happened (a tx hash,
  an execution ID with a completed status you fetched).
- **FAILED** — you have positive proof it did *not* happen (a 4xx you
  understand, a simulation that reverted before broadcast).
- **UNKNOWN** — anything else: a timeout, a 5xx, a dropped connection. This
  is not the same as FAILED. Something in UNKNOWN status needs to be
  reconciled later, not silently discarded.

See `references/reconciliation-pattern.md` for the shape of this as actual
TypeScript.

## Idempotency keys

Generate the idempotency key and persist it *before* the request goes out
— in your own DB/store, not just in memory. If you generate it after a
response comes back, a timeout on the request itself leaves you with
nothing to check against and no way to avoid a duplicate on retry.

See `references/idempotency.ts` for a minimal persisted-key helper.

## Retries

Only wrap a call in retry-with-backoff if it's provably idempotent (via the
key above) or read-only. Never retry a non-idempotent write blind — that
turns a transient network blip into a duplicate payout.

See `references/retry.ts` for a backoff helper that takes an idempotency
key and refuses to retry without one on non-GET calls.

## Structured logging on every failure path

Every `catch` block and every non-2xx branch logs before it returns a
clean error to the caller. At minimum: timestamp, a request/trace id,
what was being attempted, and the actual underlying error — not just the
message you're returning to the user. See `references/logger.ts` for a
small structured JSON logger with no external dependency required (swap in
Sentry/Axiom/whatever you're already using by wiring one line in the
`error()` method — the interface doesn't need to change).

## Tests for financial/safety logic

Example-based unit tests aren't enough for anything that moves money or
gates access. For each guard that exists specifically to prevent a bad
outcome:
1. Write the test that fails if the guard is removed. Actually delete the
   guard locally and confirm the test fails, then put the guard back. If
   the test still passes with the guard gone, it isn't testing what you
   think it's testing.
2. Where the logic has real invariants ("total distributed never exceeds
   total deposited," "a terminal state can't transition again"), prefer a
   property/invariant test (Foundry `invariant_*` for Solidity, fast-check
   for TypeScript) over another example-based case.

## Quick checklist before shipping

- [ ] `docs/API_NOTES.md` exists and reflects what you actually observed,
      not what the docs promised.
- [ ] Every state-changing call has a persisted idempotency key sent
      before the request, not generated after.
- [ ] No path treats "timed out" the same as "failed" — there's an UNKNOWN
      state with something to reconcile against.
- [ ] Every catch block logs the real error server-side, not just the
      client-facing message.
- [ ] Every fund-safety guard has a test that fails when the guard is
      removed (you checked this by actually removing it once).
