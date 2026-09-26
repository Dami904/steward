# LIVE.md: what's real, what's simulated, how to check it

The single place that states exactly what the demo run is, what was changed to make it run,
and how to reproduce or verify it yourself.

**Current run: 2026-09-26.** Earlier runs (2026-09-22, 2026-09-23) can no longer be loaded;
see "Findings" below for why. Every number in this file comes from
`deploy/demo-chain/snapshot.json`, which `scripts/demo-driver.ts` wrote during the run.

## What this is (and isn't)

**A real on-chain graduation history on a local fork of BNB Chain.** Every transaction below
executed the deployed `StewardAccount` / `StewardFactory` / `ConductRegistry` contracts,
through `ManagedVaultAdapter`, against the real IXS `ManagedVault`
(`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`) as it existed at BSC block **124,148,298**.
Nothing is a mock or a hand-written number.

**Not a mainnet deployment** (`spec/DECISIONS.md`, zero-funds decision):
- **No real funds.** Balances come from impersonating a large public USDC holder (Binance
  Hot Wallet 20) on the fork. Nothing was broadcast to BSC.
- **Not on a public explorer.** Instead, the chain itself is published: the hosted demo chain
  and `make demo-chain` serve this exact state, and anyone can replay it (below).
- **One fork-only change to the real vault's state**, described next.

## The one intervention: refreshing a stale NAV

On 2026-09-26 the real IXS vault was refusing every deposit. Its own `maxDeposit` returns 0
when the NAV is older than `navStalenessThreshold` (48 h, per IXS's published
`ManagedVault.sol`), and the last `setNAV` was on **2026-09-23 01:12 UTC** (BSC tx
`0xfe02b4ac84e37c29afe40036d8ca90942d1af1669a406efe1faa854f10b94fbc`). By the time of this run it
was 83 h old, so deposits had been blocked on the real vault since about 2026-09-25 01:12 UTC.
Checked on live BSC, not only on the fork: `maxDeposit` and `maxMint` were 0 for every
address, `paused()` was false and the whitelist was off.

To run the demo, the driver (`refreshStaleVaultNav`) impersonates the vault's real NAV
manager (`0xE8eA6365C329130fd47d4D1Ca0aE59CAf49fA9C4`, the sender of that last `setNAV`, which
holds `NAV_MANAGER_ROLE` on live BSC) and calls the vault's own `setNAV` with the **unchanged**
price, 1.091092. Only `priceUpdatedAt` moves. The step is recorded as `FORK_nav_refresh`, and it
runs only when the NAV is stale, so a run made after IXS updates the NAV has no intervention.

## What happened

| Step | Block | Tx |
|---|---|---|
| Agent A's account funded with 500 units (fork only) | - | - |
| `FORK_nav_refresh`: stale NAV re-set at the unchanged price | - | - |
| A deposits 100 units (clears T0's 90-unit peak requirement) | 124148303 | `0x05452c63…4816f` |
| A logs 9 HOLD decisions (T0 needs 10 receipts) | 124148304–312 | 9 txs, see snapshot |
| Fork clock advanced 700 s (T0's minimum dwell is 600 s at demo speed) | - | - |
| Anyone calls `graduate()`: all six conditions hold, **A goes T0 → T1** | 124148314 | `0x68a910ce…823c0` |
| Agent B created: a stranger with the same mandate and no record | 124148315 | `0x561202d9…40d7` |
| **A (T1, maxTx 300) deposits 200: succeeds** | 124148317 | `0x272f3317…12713` |
| **B (T0, maxTx 120) deposits the same 200: reverts `OverMaxTx`** | - | reverted in gas estimation, never mined |

Accounts: Agent A `0x4cbA1525c5be707Ba3947cEE253F96B515b20aFd`, Agent B
`0xf07822a2b18a5fdc30bdad4fe68f798b033a3465`.

`scripts/replay-fork-demo.ts` then confirmed all 13 tx hashes resolve with `status=0x1`, and
`packages/engine`'s `checkPromotion` (the function `fixtures/differential/` holds to account
against Python and Solidity) independently recomputed `eligible=true` from the on-chain
`TierState` just before `graduate()`.

## The demo chain (hosted and local)

`deploy/demo-chain/state.json` is this run's full chain state, made self-contained: every
account and storage slot any demo transaction touched was written back with its unchanged
value before the dump, so Anvil serves it with **no upstream RPC** and nothing can be pruned
out from under it. Checked by rendering `/verify`, `/app` and `/honeypot` against the live fork
and against the self-contained copy: identical text on all three.

- **Hosted:** https://steward-rwa.vercel.app/demo reads it through a read-only proxy
  (`deploy/demo-chain/proxy.mjs`) that refuses transactions and Anvil's cheat methods.
- **Local:** `make demo-chain` serves the same state on `127.0.0.1:8546`, then
  `cd apps/web && pnpm dev` and open `/demo`. No fork, no RPC key.

## How to reproduce from scratch

```bash
bash scripts/fork-node.sh --fresh                      # 1. fork at the current block
cd contracts && forge script script/DeployDemo.s.sol \
  --rpc-url http://127.0.0.1:8546 --broadcast && cd ..  # 2. deploy the stack
node --experimental-strip-types scripts/demo-driver.ts # 3. fund, (refresh NAV if stale), graduate, contrast
node --experimental-strip-types scripts/replay-fork-demo.ts  # 4. independent re-check
```

A fresh run gets new block numbers and tx hashes; the verified outcome is what reproduces.

## Findings

- **The real vault's NAV went stale and blocked all deposits** (above). This is the
  `NAV_STALE` case `spec/health.md` defines, observed on the real vault.
- **Saved fork state stopped loading (found 2026-09-26).** The 2026-09-23 dump had no
  historical states and did not contain the vault's implementation code, and the public BSC
  node had pruned its pinned block, so Anvil refused to start from it; reloading without the
  pin forked at the latest block and dropped the demo's blocks. Fixed two ways:
  `scripts/fork-node.sh` now passes `--preserve-historical-states`, and the published state is
  self-contained (above). `anvil_dumpState` over RPC does not include historical states, so
  `scripts/replay-fork-demo.ts` (which reads the block before `graduate()`) needs the live fork
  or an exit dump; the web verifier reads only current state, logs and block timestamps.
- **Pinned blocks age out of free RPCs** within days, so a fresh reproduction must re-pin.

## What this demonstrates, and what it doesn't

**Demonstrates:** earned authority is enforced by the deployed contract, the "same request,
two agents" contrast is a real pair of transactions with different outcomes, and the policy
engine and the Solidity agree on when graduation is legitimate.

**Does not demonstrate:** mainnet gas costs, MEV, reorgs, or anything needing public
third-party verification. The NAV refresh means this run's deposits happened under a vault
state the real vault was not in at that moment (same price, fresher timestamp).
