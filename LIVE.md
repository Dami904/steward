# LIVE.md — Phase 4: real vs. simulated, stated plainly

Per `serv PLAN_v2.md`'s honesty-table convention and `serv PLAN_v3.md`'s Phase 4 exit
criteria ("verifiable graduation history for Agent A, `LIVE.md` filled"). This is the
single place that states exactly what's real, what's simulated, and how to reproduce it.

**Re-run and re-verified fresh on 2026-09-23** (Phase 5 wrap-up), after finding the original
2026-09-22 run's specific fork state and pinned block were no longer reachable — see "A real
finding: the pinned block ages out" below. Every number in this file is from that fresh,
independently-confirmed run, not the original one.

## What this is (and isn't)

**This is a real, on-chain graduation history, run against a local mainnet fork.** Every
number below comes from an actual transaction that actually executed the actual deployed
`StewardAccount`/`StewardFactory`/`ConductRegistry` contracts, against `ManagedVaultAdapter`
wired to the REAL IXS vault's REAL address (`0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82`) on a
forked copy of live BSC state (pinned block, see `.fork-state/pinned-block.txt` when
reproduced). Nothing here is a mock, a unit test double, or a hand-simulated number.

**This is not a live mainnet deployment**, per `spec/DECISIONS.md`'s 2026-09-22 "Live
deployment -> fork-only" decision (made in Phase 0, reaffirmed explicitly before Phase 4
started — a testnet deployment was considered and rejected, since it could only reach a mock
vault, not the real one). Consequences, stated plainly:
- **No real funds were spent or are at risk.** Every USDC-equivalent balance used here came
  from impersonating a real, large token holder (`anvil_impersonateAccount` on Binance Hot
  Wallet 20, a publicly known address) on the LOCAL fork only — a cheatcode-adjacent operation
  that has no effect on or connection to the real chain. Nothing was broadcast to live BSC.
- **This is not independently checkable on a public block explorer.** There is no public
  transaction to look up. What replaces that: full reproducibility. Anyone with this repo can
  re-run the same pipeline and get the same kind of result — see "How to reproduce" below, and
  the honest limitation on *exact* reproducibility noted there.

## What actually happened (2026-09-23)

1. **Deployed** the full stack (`ManagedVaultAdapter`, `ConductRegistry`, `VaultHealthFeed`,
   `StewardFactory`) onto a persistent local Anvil fork pinned at block **123520781**
   (`contracts/script/DeployDemo.s.sol`), and created **Agent A**'s `StewardAccount`
   (`0x7Aa2Ed4FB8c05c2d1506D5a4DFC68e2F23Ea77D8`) at tier T0 — the same starting point any
   real stranger gets.
2. **Funded** Agent A's account with 500 units of the vault's real underlying asset (local
   fork only, whale impersonation, see above) — tx
   `0xfd9612db508a14e547dee69147688808719deb48c986f6edff8786944876ae05`.
3. **Drove Agent A through 10 real transactions** (`scripts/demo-driver.ts`): one 100-unit
   deposit (tx `0xfd9612db...`, clearing T0's 90-unit peak-exposure requirement) and nine
   `logDecision` calls (clearing T0's 10-receipt minimum) — all against the real
   `deposit()`/`logDecision()` functions on the deployed contract, not a simulation of them.
4. **Advanced the fork's clock** 700 seconds (past T0's 600-second minimum dwell,
   `Types.DEMO_TIME_UNIT_SECONDS = 60`) via Anvil's own `evm_increaseTime`/`evm_mine` — the
   same mechanism `forge test`'s `vm.warp` uses, just driven from outside the test framework
   so it's a real, externally-observable state change on this specific fork.
5. **Called `graduate()`** — a real transaction, callable by anyone, that succeeded because
   all six on-chain promotion conditions genuinely held. Agent A: **T0 → T1.** Tx
   `0x3764ea3d64eaf55eafe30f29c172662db14f5934417000e48ec6a10c495e4227`.
6. **Created Agent B** (`0x5663ed6a12df505e1b99bc78c7f1e70c38d77e63`), a fresh stranger with an
   identical mandate and zero conduct record, via the same `StewardFactory` anyone would use —
   tx `0xca641e467dad79511cd9c39189a49bb7ebba80769c66c2b58402f3b83cd0f18d`.
7. **The contrast** (`serv PLAN_v3.md` §0: "same request, two agents"): both agents were
   asked to deposit the **same 200-unit amount**.
   - **Agent A (T1, `maxTx` = 300 units): succeeded.** Local fork tx
     `0x24fe63686f2681187de2a96d447a0e8780471ba1a6a026e1d5ac396e267478fb` — not on a public
     explorer (see "How to reproduce" below for how to independently confirm it).
   - **Agent B (T0, `maxTx` = 120 units): reverted with `OverMaxTx`.** It never even reached
     the mempool as a mined transaction — it reverted during gas estimation, which is itself
     informative: the tier ceiling isn't a soft limit a caller can push through with enough
     gas, it's a hard revert before execution.

Independently re-verified via `scripts/replay-fork-demo.ts`: all 13 recorded tx hashes still
resolve with `status=0x1` against the running fork, and `packages/engine`'s `checkPromotion`
(the same function `fixtures/differential/` holds to account against Python and Solidity)
independently recomputes `eligible=true` for the T0→T1 graduation from the real on-chain
`TierState` — not a re-assertion of the driver's own claim.

Full transaction-by-transaction detail: `.demo-state/receipts.json` (13 real tx hashes, one
recorded revert, block numbers and timestamps for every step — gitignored, generated fresh by
`scripts/demo-driver.ts`, not hand-written).

## A real finding: the pinned block ages out

Re-running this demo for Phase 5's wrap-up found the *original* 2026-09-22 fork instance and
its specific pinned block (123384051) no longer usable — `forge script` against it now fails
with `state ... is pruned`, and the original run's own tx hash
(`0x6807e5a8f29019cb849a1c64a2a664621e0010e2b060d8cdb99296bcac1022a9`, previously cited in
this file) no longer resolves on any currently-running fork. This is the same class of RPC
archive-access flakiness documented throughout this project (`docs/API_NOTES.md`), but a
harder failure mode than seen before: not intermittent, but a real expiration — the free
public RPC's archive window doesn't hold a pinned block forever, even one that worked
correctly when first pinned. **Consequence for this file's own claim:** the *specific*
transaction hashes above are only good until the upstream RPC prunes this pinned block too —
"reproducible" here means "the same pipeline, re-run fresh, produces the same kind of
verified result," not "these exact hashes stay resolvable indefinitely." Re-run the pipeline
(below) to get a currently-valid set.

**Also found and fixed while re-running:** two real gaps in `scripts/demo-driver.ts`, not
just in this file's data:
- Agent A's funding was previously a manual, *undocumented* step — this file's own
  reproduction instructions said "see `scripts/demo-driver.ts`'s header for the exact `cast`
  commands," but no such commands existed anywhere in that file. Caught only by trying to
  reproduce the demo from scratch and hitting a real `OverCapacity` revert on an unfunded
  account. Fixed: the driver now self-funds Agent A the same way it already self-funds Agent
  B (`fundFromWhale`), so the whole pipeline is genuinely single-command reproducible.
- Every transaction in this specific re-run hit the known "archive requests require a
  personal token" transient-error path (worse flakiness than the original run, which had at
  least some clean successes) — `robustSend`'s existing recovery logic correctly detected
  each one as already-succeeded via its on-chain probe, but previously recorded the tx hash
  as permanently `null` in that case. Fixed: added `findRecentTxTo`, which looks up the
  actual hash from the newly-mined block (Anvil mines one block per tx here, confirmed) after
  a recovery, so `.demo-state/receipts.json` now has real hashes even when every single send
  needed the recovery path — as it did this run.

**Not resolved this session, stated honestly rather than glossed over:** attempted to persist
the running fork's state via `anvil_dumpState` (the RPC method) written directly to
`.fork-state/anvil-demo-state.json` for `--load-state` to pick up later. This failed —
`--load-state` rejected the file with `invalid type: integer 0, expected struct
SerializableState` — meaning the RPC method's return format and the CLI flag's on-disk file
format are not directly interchangeable the way this was assumed to work (a plausible cause:
`anvil_dumpState` returns a hex-encoded string for JSON-RPC transport, while `--dump-state`
may write the same underlying bytes as raw binary, not hex text — untested, not confirmed).
The reliable path today is `scripts/fork-node.sh`'s own `--dump-state` flag writing on a
*clean* shutdown (`Ctrl-C`/`SIGTERM`) of a process it started itself, not a hand-rolled dump
via RPC against an already-running process. Worth fixing properly in a future session if
exact state persistence across restarts becomes load-bearing for a live demo.

## How to reproduce (and independently verify, not just re-read this file)

```bash
# 1. Start the persistent fork (foreground; run in a separate terminal, or backgrounded)
bash scripts/fork-node.sh --fresh

# 2. Deploy the stack onto it (from contracts/)
cd contracts && forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:8546 --broadcast

# 3. Run the driver — self-funds Agent A and Agent B, then drives the full graduation +
#    contrast sequence. Real transactions, ~1-2 minutes. No manual funding step needed.
node --experimental-strip-types scripts/demo-driver.ts

# 4. Independently re-verify: confirms every tx hash still resolves, AND recomputes the
#    graduation predicate using packages/engine's checkPromotion (the same TS function
#    differential-tested against Python and Solidity throughout this project) fed with the
#    real on-chain TierState — not a re-assertion of step 3's own claim, a second, independent
#    computation that has to agree.
node --experimental-strip-types scripts/replay-fork-demo.ts
```

If step 2 fails with `state ... is pruned`, the pinned block has aged out of the upstream
RPC's archive window (see the finding above) — re-run step 1 with `--fresh` to pin a current
block, then retry from step 2. `--fresh` always re-pins; omitting it tries to load a previous
`--dump-state` dump if one exists, which — per the unresolved gap above — is not currently
confirmed to round-trip correctly for a hand-rolled dump, only for one Anvil wrote itself on
a clean shutdown.

## What this demonstrates, and what it doesn't

**Demonstrates:** the earned-authority mechanism is real, on-chain, and enforced by the
deployed contract — not asserted, not simulated, not a spec that was never actually run. The
"same request, two agents" contrast is a real pair of transactions with a real different
outcome, not a slide. The policy engine (`packages/engine`) and the deployed Solidity agree on
when graduation is legitimate — checked independently, not just claimed.

**Does not demonstrate:** anything about real mainnet gas costs, real MEV/front-running
conditions, real multi-block reorg behavior, or anything requiring public third-party
verification. Those all need an actual mainnet deployment, which is explicitly out of scope
for this build (`spec/DECISIONS.md`). If that decision is revisited, the exact same contracts
deploy unchanged — see `docs/THREAT_MODEL.md` for what does and doesn't change when real key
material and real funds enter the picture.
