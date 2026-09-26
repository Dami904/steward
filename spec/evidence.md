# Evidence intelligence specification

Frozen before code, per PLAN_v2 §8 and PLAN_v3 §8.2/8.4 (P4/P7, C4 in the rubric). This
governs how untrusted text becomes a deterministic input to `spec/accounting.md`'s
`EvidenceState` (`stale`, `corroboratedSevereAdverse`, `singlePathAdverse`) — the model never
sets these fields directly; this file specifies the deterministic reduction from raw model
claims to them. See `packages/engine/src/accounting.ts`'s `evidenceHealthMultiplierBps`
(already built in Phase 1) for how `EvidenceState` feeds capacity — that function is the
consumer this file's output must satisfy; nothing here changes it.

## 1. Sources and fetch

Allowlisted URLs only (IXS vault page and announcements, IXS gitbook pages, Compass changelog
or status, the issuer fact sheet if a stable URL exists — final list in `docs/API_NOTES.md`
once fetched at least once). Owner-pasted text is accepted but marked lower trust
(`sourceTrust: "ALLOWLISTED" | "OWNER_PASTED"`). Each fetched text is normalized (collapse
whitespace runs to a single space, trim) and hashed (`sha256`) before any model sees it — the
hash, not the model's paraphrase, is what a receipt commits to.

## 2. Claim schema (model output, per model call)

```
type ClaimType =
  "REDEMPTION_GATING" | "REDEMPTION_DELAY" | "UNDERLYING_CHANGE" | "NAV_METHOD_CHANGE" |
  "YIELD_CHANGE" | "CUSTODY_CHANGE" | "PAUSE" | "REGULATORY" | "OTHER";
type Polarity = "ADVERSE" | "FAVORABLE" | "NEUTRAL";
type Severity = "LOW" | "MEDIUM" | "HIGH";

interface RawClaim {
  type: ClaimType;
  polarity: Polarity;
  quote: string;    // must be verbatim from the source text, per the model's own claim
  severity: Severity;
}
```

**Severity → "severe" (design decision, not in the plan text, recorded here since the plan's
effect table uses "severe type" without defining it):** a claim is *severe* iff
`severity === "HIGH"`. This is a property of the individual claim as extracted, not a fixed
property of `type` — the same `type` (e.g. `REDEMPTION_DELAY`) can be a minor administrative
note or a severe one depending on what the source text actually says, and the model is asked
to grade it. A model that always emits `HIGH` gains nothing: severity alone never triggers a
capacity effect, only `severity == HIGH` **and** `polarity == ADVERSE` **and**
`corroborated == true` does (§4).

## 3. Pipeline

1. Fetch, normalize, hash (§1).
2. Call the reasoning API twice with **different models** (e.g. one OpenAI-family, one
   Anthropic-family model behind the same OpenAI-compatible endpoint — see
   `docs/API_NOTES.md` for which are actually available), each with a strict JSON schema
   response of `{ claims: RawClaim[] }`. Tool use: `serv_prompt_guard` always; the hint
   instructs "every claim must include a verbatim quote from the source text; only claim what
   the text actually states; if nothing in the source matches a claim type, return no claim
   for it."
3. **Deterministic grounding** (`groundClaims`, pure function, this file's code): a claim's
   `quote`, after the same whitespace normalization as the source, must appear as a literal
   substring of the normalized source. Ungrounded claims are dropped and counted
   (`ungroundedCount`); they never reach corroboration or the effect table. This is the
   anti-hallucination gate — model text is never trusted, only checked.
4. **Corroboration** (`corroborate`, pure function): a claim from model A and a claim from
   model B correspond, and are marked `CORROBORATED`, iff all of:
   - same `type`
   - same `polarity`
   - their grounded quotes' matched character ranges in the normalized source **overlap**
     (`startA < endB && startB < endA`) — same *region*, not just the same shape of claim.
     Two different sentences making the same-typed claim about different parts of the
     document are `SINGLE` for each, not corroborated; this is deliberate (§6 anti-gaming).
   A claim with no corresponding claim from the other model is `SINGLE`. Claims are matched
   at most once (greedy, first-fit by source order) — a model cannot corroborate itself by
   emitting duplicates.
5. **Effect table** (`deriveEvidenceFlags`, pure function; feeds `EvidenceState`):

   | Claim | Effect on `EvidenceState` |
   |---|---|
   | `ADVERSE`, severe (`HIGH`), `CORROBORATED` | `corroboratedSevereAdverse = true` |
   | `ADVERSE`, otherwise (not both severe and corroborated) | `singlePathAdverse = true` |
   | `FAVORABLE`, any | Recorded in the claim log only. Never sets any `EvidenceState` field. |
   | `NEUTRAL` | Recorded only. |

   `corroboratedSevereAdverse` and `singlePathAdverse` are not mutually exclusive at the
   claim-set level (different claims can trigger each); `corroboratedSevereAdverse` is
   checked first by `evidenceHealthMultiplierBps` (spec/accounting.md §4) so it always wins
   when both are true — one severe corroborated adverse claim zeroes capacity regardless of
   what else is in the set.
6. **Recovery:** capacity may return only through the owner (`setCap`/`unpause`, immediate) or
   through `proposeLoosenCap` (owner-gated or veto-windowed, `contracts/src/StewardAccount.sol`)
   — never automatically from the evidence pipeline itself. The plan's "quiet window with no
   adverse claims" is a precondition the *owner* or the *agent's loosen proposal* judges before
   acting, not a new on-chain automatic mechanism; this file does not add one. `quietWindowOk`
   (§7) is provided as a pure helper an operator UI or the agent's proposal reasoner can check
   before proposing a loosen, but it never itself moves a cap.

## 4. `evidenceSnapshotId` binding

Every `Decision` receipt (`spec/accounting.md` §8) commits to `evidenceSnapshotId`. For a
deposit decision this is `hashClaimSet(groundedClaims)` — sha256 over the canonical
serialization `type|polarity|severity|status|quoteHash`, sorted by
`(sourceUrl, type, polarity, quote)`, one line per grounded claim, joined with `\n` (ungrounded
claims are excluded — they never entered the effect table, so they don't affect the hash,
though `ungroundedCount` is logged separately in `docs/API_NOTES.md`-style operational logs,
not on-chain). Mirrors `spec/health.md` §3's `evidenceHash` pattern exactly, same rationale:
anyone can recompute it from the logged raw claims and compare.

## 5. Griefing defense (PLAN_v2 §8.3, carried over)

An attacker who plants adverse-looking text on an allowlisted, owner-controlled or
issuer-controlled source is already assumed to have a foothold the allowlist itself should
prevent; the remaining defense is inside this pipeline:
- Forced full derisk (`corroboratedSevereAdverse`) needs **both** severity and corroboration
  across two independently-called models — a single compromised or unlucky model call can
  only produce `singlePathAdverse` (half health, not zero).
- Every adverse effect is logged with the grounded quote and its source, so an owner can see
  and override (`setCap`) immediately; nothing here is silent.
- Rate limits on how often auto-tightening from evidence can fire are the account-level
  `maxActionsPerDay` / tightening-is-cheap-anyway property already in
  `contracts/src/StewardAccount.sol` — tightening never needs approval, so a griefing attempt
  costs the attacker nothing to trigger but also nothing to reverse once the owner notices.

## 6. Anti-gaming, stated openly

- A model cannot corroborate itself: corroboration requires two *separate* calls (different
  models), and matching is one-to-one (§3.4).
- Region-overlap corroboration (not just same-type-and-polarity) means an attacker can't get a
  cheap corroboration by having two unrelated true-but-irrelevant adverse statements exist
  anywhere in a long document.
- Favorable claims never loosen anything (§3.5) — the only way capacity actually goes back up
  is the owner or an owner-gated/veto-windowed proposal, never model output, matching the
  top-level invariant in `CLAUDE.md`.

## 7. Off-chain invariants (each is a test, extends `spec/accounting.md` §7)

- **P-09** (already listed in accounting.md, now given a concrete mechanism here): favorable
  claims never set `corroboratedSevereAdverse` or `singlePathAdverse` — `deriveEvidenceFlags`
  only reads `ADVERSE` claims.
- **P-10** (already listed): a claim without a verbatim source quote is dropped by
  `groundClaims` before it can reach `deriveEvidenceFlags` or `corroborate`.
- **P-15** `corroborate` is symmetric in its two inputs up to which claim is "A" vs "B" —
  swapping the two models' claim arrays produces the same `CORROBORATED`/`SINGLE` partition
  (by claim identity, not array position).
- **P-16** `hashClaimSet` is order-independent in its input (`groundClaims` output may arrive
  in either model-call order; the canonical sort in §4 makes the hash stable) and
  byte-identical between the TypeScript and Python implementations for the same claim set
  (extends P-08's three-way-parity requirement to this module).
- **P-17** `quietWindowOk` returns `false` whenever any claim in the window (inclusive of the
  boundary) has `polarity == ADVERSE`, `true` only when none do — a pure boundary check, no
  network or clock dependency beyond the caller-supplied `now`.

## 8. What this file does not cover

- The actual HTTP call to the reasoning API, retry/timeout behavior, and cost — measured
  behavior lives in `docs/API_NOTES.md`, client code in `packages/engine`'s SERV client
  module. This file specifies only the deterministic reduction from claims (however obtained)
  to `EvidenceState` fields; that reduction is what's differential-tested and does not need a
  live API call to test.
- The proposal reasoner's own output schema (`action`/`amount`/`rationale`/...) — see PLAN_v2
  §9 and the reasoner client code; unrelated to claim grounding beyond both being SERV calls.
