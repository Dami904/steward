---
name: onchain-access-control
description: Use this whenever designing or writing a permission system, an access policy, a capability/role model, or anything that anchors a proof, receipt, or attestation on-chain. Trigger whenever the user mentions access control, permissions, grants/revokes, an allowlist, a policy table, a signed receipt, an on-chain proof, or an admin/owner key. Applies to Move, Solidity, Rust (Anchor/Soroban), or any contract language, and to off-chain policy gates that sit in front of an on-chain settlement step.
---

# On-chain Access Control & Proof Integrity

The goal: a permission check or an anchored proof should be trustworthy
because of what the chain enforces, not because of what your server
claims. Five patterns, each one line of discipline, each one a real bug
class if skipped.

## 1. Default-deny, always

An unconfigured `(actor, resource)` pair must resolve to **denied**, never
allowed. Implement this as "absent key in the policy table means false,"
not "allowed unless explicitly blocked." A new namespace, a new agent, a
typo in a key, all of these should fail closed. This is one `if` statement
and it is the difference between a silent privilege widening and a safe
default when someone forgets to configure a case.

```
// Wrong: widens by default
fn is_allowed(actor, resource) -> bool {
    !policy.get(actor, resource).unwrap_or(true) // BUG: defaults to allowed
}

// Right: fails closed
fn is_allowed(actor, resource) -> bool {
    policy.get(actor, resource).unwrap_or(false)
}
```

## 2. Guard the read-then-settle gap (TOCTOU)

Anywhere you read a permission or a piece of state, do work (call an LLM,
wait for a signature, batch a job), then settle on-chain later, the
permission can change in that gap. Cite the version of the state you read
at settlement time, and reject if it moved:

- Add a monotonically increasing `policy_version` (or `nonce`,
  `sequence`) to the policy/state object.
- Bump it only on an *effective* change (re-asserting the current value
  should not burn a version, or you'll invalidate in-flight receipts for
  no reason).
- The settlement call takes the version it was computed against as an
  argument and aborts if it no longer matches current state.

This turns "a revoke landing mid-flight gets silently papered over" into
a hard on-chain rejection.

## 3. Recompute the verdict, don't trust the claim

If an off-chain process (your server, an agent, an LLM) hands the chain a
claim like "this action was authorized," the contract must recompute that
verdict from its own source of truth, not just store the claimed boolean.
Loop over what was actually used/claimed and check each one against the
real policy on-chain. A forged or stale claim then gets anchored as
`authorized: false` by the chain itself, consensus catches it, not your
own test suite.

## 4. Replay and expiry on anything anchored

Any receipt, attestation, or signed proof that gets submitted on-chain
needs both:
- **A single-use nonce**, checked against a spent-nonce set, so the same
  proof can't be anchored twice.
- **A caller-supplied expiry**, checked against chain time (not
  wall-clock/caller-supplied time), so an old authorized proof can't be
  replayed later after conditions changed.

Missing either one turns a legitimate proof into a reusable token.

## 5. Separate "can append" from "can change the rules"

The hot key that anchors routine receipts/proofs day-to-day should hold
no capability to change the access policy itself. If it leaks, the
blast radius is "attacker can submit bogus proofs" (caught by #3 above),
not "attacker can grant themselves access to everything." Keep the
policy-changing capability (an owner cap, an admin role, a multisig) on a
completely separate credential from the one your server/agent uses
routinely.

## Bonus: tamper-evident history, cheaply

If you're anchoring a sequence of receipts/events and want them
provably ordered and un-excisable, link each one to the previous with a
hash chain: `chain_digest = hash(prev_digest ++ this_digest)`. Reordering
or deleting an entry breaks every digest after it. This is a few lines
and turns "trust our database's ordering" into "verify the chain
yourself."

## Checklist before shipping an access-control or proof-anchoring change

- [ ] Every unconfigured `(actor, resource)` pair denies by default.
- [ ] Every settlement that reads permission/state earlier than it acts
      cites the version it read and rejects on staleness.
- [ ] Every on-chain "authorized" verdict is recomputed on-chain, never
      taken as a caller-supplied flag.
- [ ] Every anchored receipt/proof has a single-use nonce and an
      expiry checked against chain time.
- [ ] The key/role that can append proofs is different from the key/role
      that can change the policy.
- [ ] `docs/THREAT_MODEL.md` (see `integration-dev-experience` skill)
      names what happens if each of these keys/roles is compromised.
