# Measurement report: claimed vs. measured vault liquidity

Per `spec/health.md` §6.4: the "vendor claims vs. measured behavior" contrast the pitch
leans on. Measured side is real, reproducible, and re-derived
live (never hardcoded); claimed side is quoted from an actual IXS/Compass source, not
paraphrased or guessed.

## Measured (real, reproducible)

Reproduce with `make measure-health` (read-only; needs network, no API key or funded wallet —
see `scripts/live-health-snapshot.ts`). Snapshot below taken 2026-09-24 at BSC block
123,735,963 against the real vault (`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`), method
`REQUEST_FINALIZE_VIEW` (`spec/health.md` §2). Raw data: `docs/measurement-report.json`. The
earlier 2026-09-22 snapshot (block 123,335,856) showed the same request history, so nothing
settled in between.

| Metric | Value |
|---|---|
| Sample size (`n`, **finalized** requests only) | 6 |
| p50 latency (finalized only) | 926 s ≈ 0.26 hours |
| p90 latency (finalized only) | 1,096,620 s ≈ 304.6 hours ≈ **12.7 days** |
| max latency (finalized only) | 1,096,620 s (same request as p90) |
| Total requests seen | 8 (ids 1–8): 6 finalized, **2 still pending**, 0 rejected |
| Oldest pending request | id 2, open **107.1 days** at snapshot time |
| Other pending request | id 6, open **63.0 days** at snapshot time |
| NAV per share | ≈ 1.0911 (not 1:1 — confirmed independently in `contracts/test/fork/ModeA.t.sol`) |
| Vault total assets | ≈ 655.87 USDC |
| Runtime codehash (implementation `0x96d1...9FF0`) | matches Phase 0/2's recorded value |
| Paused | false at read time (admin-mutable, re-check before acting — never cache) |

Every request the vault has ever recorded (`redeemRequests(1..8)`), as read at that block:

| id | Requested (UTC) | Shares | Status | Wait |
|---|---|---|---|---|
| 1 | 2026-06-08 06:54 | 1.0000 | Finalized | 0.06 h |
| 2 | 2026-06-09 07:08 | 0.1000 (≈ 0.11 USDC) | **Pending** | **107.1 days and counting** |
| 3 | 2026-06-09 14:28 | 0.0919 | Finalized | 0.26 h |
| 4 | 2026-06-26 01:53 | 0.6000 | Finalized | 0.00 h (17 s) |
| 5 | 2026-07-06 06:14 | 101.0000 | Finalized | 2.79 h |
| 6 | 2026-07-23 09:52 | 96.3335 (≈ 105 USDC) | **Pending** | **63.0 days and counting** |
| 7 | 2026-08-04 08:07 | 115.2027 | Finalized | 45.38 h |
| 8 | 2026-08-06 15:11 | 188.5992 | Finalized | 304.62 h (12.7 days) |

**The finalized-only p90/max understates the tail.** The percentile counts only requests
that finished, so a request that never finishes never appears in it. Two of the eight
requests, 25%, had not settled after 63 and 107 days. "Max ≈ 12.7 days" is therefore the
slowest *settled* request, not the longest anyone has waited. What the chain shows is: settled
requests took anywhere from seconds to 12.7 days, and two others are unsettled after two
months or more. Chain data alone does not say why. Request 2 is dust (about 0.11 USDC) and may
simply not be worth an operator's time; request 6 is a normal-sized redemption.

### Deposits: blocked by a stale NAV (observed 2026-09-26)

The vault's own `maxDeposit` returns 0 when the NAV is older than `navStalenessThreshold`
(IXS's published `ManagedVault.sol`). Read on live BSC at about 13:04 UTC on 2026-09-26:

| Field | Value |
|---|---|
| `priceUpdatedAt` | 2026-09-23 01:12:23 UTC (tx `0xfe02b4ac84e37c29afe40036d8ca90942d1af1669a406efe1faa854f10b94fbc`) |
| `navStalenessThreshold` | 172,800 s (48 h) |
| NAV age at read | 83 h |
| `maxDeposit` / `maxMint` | 0 for every address checked |
| `paused()` / `whitelistEnabled()` | false / false |

So the vault had accepted no deposits from anyone since about 2026-09-25 01:12 UTC, for 36 h
by the time of the read. This is a guard working as designed (no deposits at a stale price),
but it is liquidity in the other direction: capital that wants in cannot get in until the
operator posts a NAV. One observation, not a rate: n = 1, and how often it happens is unknown.

## Claimed (sourced 2026-09-24)

Source: Compass API docs, ["Access the IXS Vault"](https://docs.compasslabs.ai/v2/quick-guides/ixs-vault).
Checked word for word against the live page's HTML on 2026-09-24; the page uses typographic
apostrophes (’), reproduced here:

> "Redemptions don’t. You submit a request and the vault operator settles it later, within a defined window."

> "Redemptions settle asynchronously. The vault operator finalizes them on its own schedule, not instantly."

> "There is no instant sell for this vault, so don’t expect a same-second withdrawal."

The [IXS vaults page](https://www.ixs.finance/vaults): its static HTML (fetched 2026-09-24)
contains no redemption or liquidity timing at all. If vault details are loaded dynamically
after page load, that check would not see them. The search-result summary of IXS's marketing
copy says "daily liquidity" for the product line generally; that was not confirmed on a
per-vault page.

**Side by side.** The documented claim is "a defined window", with no number attached to it.
Measured, the requests that did settle had a p50 of ~0.26 hours and a p90/max of ~12.7 days
(n = 6), and two more requests are unsettled after 63 and 107 days. So the finding is not that
a specific figure is wrong: the docs name no figure. It is that the window's length is not
published, the settled waits span seconds to 12.7 days, and a quarter of all requests ever made
are still open after more than two months. Whether any of that falls inside the "defined
window" can't be answered, because the window's length isn't published in the sources checked.

## Method honesty (spec/health.md §5)

Method used: `REQUEST_FINALIZE_VIEW` — the full on-chain request/finalize history, read via
plain view calls (`redeemRequests(1..nextRedeemRequestId()-1)`), not a sampled or self-only
view. This ranks above `OWN_REQUESTS` in the method ladder (`spec/health.md` §2) precisely
because it isn't biased by only watching your own transactions.

Two limits on the numbers above. `n = 6` is a small sample by statistical standards; the
p90/max figures are dominated by a single request and should be read as "at least one
redemption took ~12.7 days," not as a stable percentile estimate. And the method is
right-censored by construction: `spec/health.md` §2 and `packages/engine/src/health.ts` count
only `status == Finalized` records as latency samples, so pending requests, however old, never
raise the percentile. The health feed this repo publishes therefore under-reports the tail on
this vault today; see `docs/LIMITATIONS.md`. Never present the p90 as a doc constant or a
marketing figure; it is a direct measurement with these two caveats attached.
