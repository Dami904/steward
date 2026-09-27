# Vault Health Feed specification

Frozen before code, then updated with what verification against the real vault found: the real vault is not
ERC-7540, so the method ladder gets a fifth label the original plan didn't have
(found by reading the real vault's source and state).

## 1. What it measures (per vault, over a stated block window)

- Redemption latency samples, matched request to fulfillment, labeled by **method**:
  `REQUEST_FINALIZE_VIEW` (new — see §2), `FULFILL_EVENT`, `CLAIM_EVENT`, `OWN_REQUESTS`, or
  `DOC_CONSTANT` (no measurement).
- Latency p50, p90, max, sample count `n`.
- NAV per share, high-water mark, drawdown in bps.
- Runtime codehash and, if a proxy, implementation slot; pause flag if readable.
- Freshness: last NAV update time.
- Queue depth if derivable (pending shares over total supply, or `pendingRedeemCount()` on
  this vault directly — it's a public view here, no derivation needed).

## 2. Method ladder, updated for the real vault

The IXS vault (`ManagedVault` at `0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`) is not
ERC-7540. It exposes its own request/finalize interface, fully queryable on-chain:

```
requestRedeem(shares, receiver) -> id
redeemRequests(id) view -> (owner, receiver, shares, priceAtRequest, feeBpsAtRequest,
                             requestedAt, processedAt, status)
status in {None, Pending, Finalized, Rejected}
events: RedeemRequested, RedeemRequestFinalized, RedeemRequestRejected
```

**Method `REQUEST_FINALIZE_VIEW`**: iterate `id` from 1 to `nextRedeemRequestId() - 1`
(currently 9), read `redeemRequests(id)` for each, and take
`processedAt - requestedAt` for every `status == Finalized` record as one latency sample.
This reads the *entire* history in a handful of view calls — no log-range/archive-node
limitation, and no sampling bias from only watching your own requests. Rank this method above
`OWN_REQUESTS` in the ladder: prefer it whenever the vault exposes indexed request state this
way, and fall back to `OWN_REQUESTS` only if a vault has async redemption but no public way to
enumerate other users' requests.

Phase 0 sample (re-derive live at engine runtime, do not hardcode): `nextRedeemRequestId()`
reads `9`, i.e. `8` requests exist (ids `1..8`), `2` pending, `0` rejected, `6` finalized —
`n` in the `HealthSnapshot` struct is the finalized/latency-sample count, `6`, not the total
request count. Latencies `[0.00h, 0.06h, 0.26h, 2.79h, 45.38h, 304.62h]`. This already clears
the `n >= 5` threshold in `spec/accounting.md` §3. Re-verified live in Phase 3
(`scripts/live-health-snapshot.ts`, `p50Sec = 926` ≈ `0.26h` ✓) — the original "`n = 9` total
requests" phrasing here conflated the snapshot field with the total request count; corrected.

## 3. Contract

```solidity
struct HealthSnapshot {
  uint64 fromBlock; uint64 toBlock; uint40 ts;
  uint8  method;            // REQUEST_FINALIZE_VIEW | FULFILL_EVENT | CLAIM_EVENT | OWN_REQUESTS | DOC_CONSTANT
  uint16 n; uint32 p50Sec; uint32 p90Sec; uint32 maxSec;
  uint128 navPerShare; uint16 drawdownBps; bytes32 codehash; uint32 flags; // PAUSED, CODEHASH_CHANGED, NAV_STALE
  bytes32 evidenceHash;
}
interface IVaultHealth {
  event Published(address indexed vault, uint64 indexed id, uint8 method, uint16 n, bytes32 evidenceHash);
  function publish(address vault, HealthSnapshot calldata s) external;   // registered reporters only
  function healthOf(address vault) external view returns (HealthSnapshot memory, uint64 id);
}
```

`method` enum values: `0=REQUEST_FINALIZE_VIEW, 1=FULFILL_EVENT, 2=CLAIM_EVENT,
3=OWN_REQUESTS, 4=DOC_CONSTANT` (canonical order — must match across TS/Python/Solidity).

Snapshots carry `fromBlock` and `toBlock`, so anyone can recompute them from vault state with
the open-source library (`make measure-health` does this from live view state and prints the
`evidenceHash`). Since the chosen method here reads current view state rather than a fixed log
range, `fromBlock`/`toBlock` bound the block at which the snapshot was taken (single block,
`fromBlock == toBlock`), and `evidenceHash` commits to the full list of
`(id, requestedAt, processedAt, status)` tuples read, so a mismatch against a published
snapshot would be detectable.

**Not implemented:** a tool that reads a snapshot published to `VaultHealthFeed` and
compares it with a fresh recomputation. The web verifier does not read health snapshots, so
nothing currently flags a mismatch.

**Known limit of this method:** only `status == Finalized` records become latency samples
(§2), so requests that are still pending never raise `p90Sec`/`maxSec`. On the real vault, as
of 2026-09-24, 2 of 8 requests are pending after 63 and 107 days; see
`docs/measurement-report.md` and `docs/LIMITATIONS.md`.

## 4. Consumption is tighten-only

StewardAccount reads `healthOf(vault)` on each deposit:

- Snapshot stale beyond `maxStaleSec`, or `flags` contains `PAUSED` or `CODEHASH_CHANGED`:
  `healthCap = 0` (no new deposits; exits unaffected).
- `p90Sec` above the mandate's lead-time assumption, or drawdown beyond half the pause
  threshold: `healthCap = half of capMandate`.
- Otherwise no restriction.

The feed can never raise any cap, lower any reserve, or promote any tier (invariant O-13). A
dead or malicious reporter can only stop new risk. This is the fail-safe direction.

Phase 0 note: `p90Sec` on the real sample is dominated by the 304.6h (~1.1M second) outlier —
report both p50 and p90/max in the UI rather than collapsing to one number, since `n=6` is
small and the distribution is bimodal (near-instant vs. multi-day). Don't let a single outlier
silently zero out `healthCap` on every deposit; that's a legitimate tighten-only outcome if it
happens, but it should be visibly explained, not just asserted.

## 5. Method ladder and honesty

Phase 0 determines the best available method (done: `REQUEST_FINALIZE_VIEW`). The UI and
README always print `method` and `n`. Never present a doc constant as a measurement.

## 6. Consumers shipped

1. StewardAccount (on-chain, tighten-only).
2. `@steward/vault-health` npm package and a public HTTP endpoint (or, under the zero-funds
   plan, the equivalent read exposed from the fork/replay tooling).
3. A tiny reference agent in `examples/naive-agent` (independent code, no Steward contracts)
   that reads the feed and declines to deposit when p90 exceeds its own threshold.
4. **Measurement report** (`docs/measurement-report.md`): claimed liquidity (IXS docs: daily
   liquidity; Compass: operator-settled on its own schedule) vs. measured latency, with
   method, n, and the block range. The 304.6-hour (~12.7-day) real finalized request is the
   headline contrast number — get the actual claimed lead time from IXS/Compass docs at
   report-writing time and quote it side by side, don't paraphrase.

## 7. New off-chain invariant (Phase 0 addition)

**P-14b** `REQUEST_FINALIZE_VIEW` sample construction is deterministic: given the same
`(nextRedeemRequestId, redeemRequests[1..n])` input, the TypeScript and Python
implementations produce byte-identical `p50Sec/p90Sec/maxSec/n` and the same `evidenceHash`.
Extends invariants P-13/P-14.
