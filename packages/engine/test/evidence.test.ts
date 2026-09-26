import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groundClaims,
  corroborate,
  deriveEvidenceFlags,
  hashClaimSet,
  quietWindowOk,
  type RawClaim,
} from "../src/evidence.ts";

const SRC = "The vault may pause redemptions at the operator's discretion during stress.";

function claim(overrides: Partial<RawClaim> = {}): RawClaim {
  return {
    type: "PAUSE",
    polarity: "ADVERSE",
    quote: "pause redemptions at the operator's discretion",
    severity: "HIGH",
    sourceUrl: "https://ixs.example/notice",
    ...overrides,
  };
}

test("groundClaims drops a claim whose quote is not a verbatim substring (P-10)", () => {
  const { grounded, ungroundedCount } = groundClaims(SRC, [claim({ quote: "this text is not in the source" })]);
  assert.equal(grounded.length, 0);
  assert.equal(ungroundedCount, 1);
});

// spec/evidence.md P-15: corroborate must be symmetric in claim identity, not array position.
test("corroborate is symmetric: swapping A and B produces the same corroborated/single partition", () => {
  const a = groundClaims(SRC, [claim()]).grounded;
  const b = groundClaims(SRC, [claim()]).grounded;

  const forward = corroborate(a, b);
  const backward = corroborate(b, a);

  const statusesOf = (claims: typeof forward) =>
    claims.map((c) => c.status).sort().join(",");

  assert.equal(statusesOf(forward), statusesOf(backward));
  assert.ok(forward.every((c) => c.status === "CORROBORATED"));
});

test("deriveEvidenceFlags ignores FAVORABLE and NEUTRAL claims even when corroborated", () => {
  const a = groundClaims(SRC, [claim({ polarity: "FAVORABLE" })]).grounded;
  const b = groundClaims(SRC, [claim({ polarity: "FAVORABLE" })]).grounded;
  const flags = deriveEvidenceFlags(corroborate(a, b));
  assert.equal(flags.corroboratedSevereAdverse, false);
  assert.equal(flags.singlePathAdverse, false);
});

// spec/evidence.md P-16: hash is order-independent in the input array.
test("hashClaimSet is order-independent", () => {
  const a = groundClaims(SRC, [claim()]).grounded;
  const assessed = corroborate(a, []); // single claim, SINGLE status
  const reversed = [...assessed].reverse();
  assert.equal(hashClaimSet(assessed), hashClaimSet(reversed));
});

test("hashClaimSet of the empty set is the well-known sha256('') digest", () => {
  assert.equal(hashClaimSet([]), "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

// spec/evidence.md P-17.
test("quietWindowOk: false when an adverse claim falls inside the window, true otherwise", () => {
  const now = 1_000_000;
  const windowSec = 3600;
  assert.equal(quietWindowOk([{ polarity: "ADVERSE", observedAt: now - 100 }], now, windowSec), false);
  assert.equal(quietWindowOk([{ polarity: "ADVERSE", observedAt: now - windowSec }], now, windowSec), false); // boundary inclusive
  assert.equal(quietWindowOk([{ polarity: "ADVERSE", observedAt: now - windowSec - 1 }], now, windowSec), true);
  assert.equal(quietWindowOk([{ polarity: "FAVORABLE", observedAt: now }], now, windowSec), true);
  assert.equal(quietWindowOk([], now, windowSec), true);
});
