// Demo driver (zero-funds build, fork only; the plan: "start Agent A on chain as early as possible in demo-speed
// tiers so a real multi-tier graduation history exists before the recording").
//
// Drives Agent A (deployed by contracts/script/DeployDemo.s.sol) through a real sequence of
// on-chain actions against the persistent Anvil fork (scripts/fork-node.sh) until it earns a
// T0 -> T1 graduation, then creates Agent B (a fresh "stranger") and submits the SAME deposit
// request from both — Agent A (now T1) succeeds, Agent B (still T0) reverts. That contrast is
// the demo's whole point: "same request, two agents".
//
// Every step here is a REAL transaction against the fork (not a simulation, not a cheatcode
// that only affects a local sandbox) — Types.DEMO_TIME_UNIT_SECONDS (60s) makes the dwell-time
// requirement a ~12-minute wait in real terms; this script uses the fork's own
// evm_increaseTime/evm_mine RPC methods to advance the fork's clock instantly instead of
// sleeping, which is honest (it's still the fork's OWN notion of time moving forward, the same
// mechanism `forge test` warps use) and practical for a reproducible script. Nothing here
// touches real BSC or spends real funds — see scripts/fork-node.sh's header.
//
// Reads `nextSeq` fresh from chain immediately before each action rather than tracking it in a
// local counter: docs/API_NOTES.md documents that the free-tier public RPC anvil forks from
// occasionally returns a transient "archive requests require a personal token" error on an
// auxiliary lookup even when the underlying transaction actually lands — a build of this
// script that tracked seq locally would silently desync from on-chain state the first time
// that happened (cast reports failure, the tx succeeds anyway, next send uses a stale seq and
// gets BadSequence). Caught this live while smoke-testing before trusting the full sequence.
//
// Usage: node --experimental-strip-types scripts/demo-driver.ts
// Requires: scripts/fork-node.sh already running, contracts/script/DeployDemo.s.sol already
// run against it (contracts/.fork-state/deployed-addresses.json must exist).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const RPC_URL = process.env["FORK_RPC_URL"] ?? "http://127.0.0.1:8546";
const ADDRESSES_PATH = "contracts/.fork-state/deployed-addresses.json";

// Anvil's well-known, publicly-documented deterministic dev private keys — safe only because
// this is a local fork; never use these anywhere real. Must match
// contracts/script/DeployDemo.s.sol's role assignment exactly. Copied verbatim from `anvil`'s
// own startup log (never hand-transcribed from memory — a first draft of this file had
// truncated/wrong keys for every account except 0, caught by a live "Failed to decode private
// key" error before this script was trusted).
const PK = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // account 0
  ownerA: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // account 1
  agentA: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // account 2
  guardianA: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // account 3
  ownerB: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // account 4
  agentB: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // account 5
  guardianB: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // account 6
};

// Addresses corresponding to accounts 4/5/6 above — Agent B's owner/agent/guardian roles.
const ADDR_B = {
  owner: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  agent: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  guardian: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
};

interface Addresses {
  adapter: string;
  registry: string;
  healthFeed: string;
  factory: string;
  accountA: string;
  ownerA: string;
  agentA: string;
  guardianA: string;
  deployer: string;
}
const addr: Addresses = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8"));

const TOKEN = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"; // Binance Hot Wallet 20 — public knowledge

// The real IXS vault blocks every deposit (maxDeposit = 0) once its NAV is older than
// navStalenessThreshold (48h). Measured 2026-09-26: last setNAV was 2026-09-23 01:12 UTC
// (BSC tx 0xfe02b4ac84e37c29afe40036d8ca90942d1af1669a406efe1faa854f10b94fbc), so the real
// vault had refused all deposits since ~2026-09-25. NAV_MANAGER below sent that tx and holds
// NAV_MANAGER_ROLE (hasRole checked on live BSC).
const VAULT = "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82";
const NAV_MANAGER = "0xE8eA6365C329130fd47d4D1Ca0aE59CAf49fA9C4";

interface ReceiptEntry {
  step: string;
  description: string;
  txHash: string | null;
  status: "success" | "reverted" | "call";
  blockNumber: number | null;
  timestampSec: number | null;
  detail?: string;
}
const receipts: ReceiptEntry[] = [];

// docs/API_NOTES.md: publicnode's free tier occasionally 403s an auxiliary lookup even on
// recent state — and, caught live while building this script, that can happen AFTER the
// underlying transaction already landed (cast reports failure, but the tx is real). A first
// draft just retried the identical `cast send` command on that error, which produced
// BadSequence on the retry (nextSeq had already moved) instead of recovering. Fixed: every
// retry re-derives its own args fresh (`buildArgs()`, not a fixed array) via `probe()`, and
// before treating an error as retryable, the probe is checked again — if it moved, the
// previous attempt already succeeded and this returns a synthetic "succeeded, tx hash
// unknown" result instead of resending (which would either double-act or hit BadSequence).
function isTransientRpcError(err: unknown): boolean {
  const details = [String(err), (err as { stdout?: string }).stdout, (err as { stderr?: string }).stderr].join(" ");
  return details.includes("Archive requests require a personal token") || details.includes("HttpError");
}

// Synchronous sleep (no subprocess): the flaky upstream RPC (docs/API_NOTES.md) seems to
// fail less under a small gap between attempts than back-to-back retries with none.
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withRetry<T>(fn: () => T, attempts = 10): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientRpcError(err)) throw err;
      if (i < attempts - 1) sleepMs(500);
    }
  }
  throw lastErr;
}

function robustSend(
  to: string,
  sig: string,
  buildArgs: () => string[],
  privateKey: string,
  probe: () => string,
  expectRevert = false,
): { hash: string | null; reverted: boolean } {
  const attempts = 10;
  for (let i = 0; i < attempts; i++) {
    const before = probe();
    const args = buildArgs();
    try {
      const out = execFileSync("cast", ["send", to, sig, ...args, "--private-key", privateKey, "--rpc-url", RPC_URL, "--json"], { encoding: "utf8" });
      const parsed = JSON.parse(out);
      const success = parsed.status === "0x1";
      if (!success && !expectRevert) throw new Error(`transaction reverted unexpectedly: ${JSON.stringify(parsed)}`);
      return { hash: parsed.transactionHash, reverted: !success };
    } catch (err) {
      const after = probe();
      if (after !== before) {
        const recoveredHash = findRecentTxTo(to);
        console.warn(`  [recovered] on-chain state advanced (${before} -> ${after}) despite a client-side error; treating as already succeeded${recoveredHash ? ` (recovered tx hash ${recoveredHash})` : ", tx hash unknown"}`);
        return { hash: recoveredHash, reverted: false };
      }
      const transient = isTransientRpcError(err);
      if (!transient || i === attempts - 1) {
        if (expectRevert) return { hash: null, reverted: true };
        throw err;
      }
      sleepMs(500);
      // Transient and state hasn't moved: loop again, buildArgs()/probe() re-run fresh.
    }
  }
  throw new Error("unreachable");
}

function castCall(to: string, sig: string, args: string[] = []): string[] {
  const out = withRetry(() => execFileSync("cast", ["call", to, sig, ...args, "--rpc-url", RPC_URL], { encoding: "utf8" }));
  return out.trim().split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((v): v is string => v !== undefined);
}

function nextSeqOf(account: string): string {
  const [seq] = castCall(account, "nextSeq()(uint64)");
  if (seq === undefined) throw new Error(`could not read nextSeq() for ${account}`);
  return seq;
}

function tierOf(account: string): string {
  const [tier] = castCall(account, "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)");
  if (tier === undefined) throw new Error(`could not read tierState() for ${account}`);
  return tier;
}

function accountsCountOf(registry: string, agent: string): string {
  const fields = castCall(registry, "recordOf(address)(uint32,uint32,uint128,uint32,uint8,uint40,uint40)", [agent]);
  const [accountsCount] = fields;
  if (accountsCount === undefined) throw new Error(`could not read recordOf(${agent}) on ${registry}`);
  return accountsCount;
}

function rpc(method: string, params: string[] = []): void {
  withRetry(() => execFileSync("cast", ["rpc", method, ...params, "--rpc-url", RPC_URL], { encoding: "utf8" }));
}

// Recovers the real tx hash for a `robustSend` call that took the "recovered" path (the
// probe moved, so the transaction landed, but `cast send` itself never returned a hash).
// Anvil mines one block per transaction by default (confirmed: every recorded blockNumber in
// a full run increments by exactly 1), so the newly-mined block has exactly one transaction —
// this looks it up directly rather than leaving the receipt permanently hash-less. Best
// effort: if the lookup itself hits the same transient RPC flakiness, or the block doesn't
// contain exactly one tx to the expected address (a genuinely different mining pattern), this
// returns null rather than guessing — a missing hash is honest; a wrong one isn't.
function findRecentTxTo(to: string): string | null {
  try {
    const out = withRetry(() => execFileSync("cast", ["rpc", "eth_getBlockByNumber", "latest", "true", "--rpc-url", RPC_URL], { encoding: "utf8" }));
    const block = JSON.parse(out);
    const txs: Array<{ hash: string; to: string | null }> = block.transactions ?? [];
    const matches = txs.filter((tx) => tx.to?.toLowerCase() === to.toLowerCase());
    return matches.length === 1 ? matches[0]!.hash : null;
  } catch {
    return null;
  }
}

function blockInfo(): { number: number; timestampSec: number } {
  const number = Number(withRetry(() => execFileSync("cast", ["block-number", "--rpc-url", RPC_URL], { encoding: "utf8" })).trim());
  const ts = withRetry(() => execFileSync("cast", ["block", "latest", "--field", "timestamp", "--rpc-url", RPC_URL], { encoding: "utf8" })).trim();
  return { number, timestampSec: Number(ts) };
}

function receiptHash(label: string): string {
  return execFileSync("cast", ["keccak", label], { encoding: "utf8" }).trim();
}

function record(step: string, description: string, result: { hash: string | null; reverted: boolean } | null, detail?: string): void {
  const { number, timestampSec } = blockInfo();
  receipts.push({
    step,
    description,
    txHash: result?.hash ?? null,
    status: result === null ? "call" : result.reverted ? "reverted" : "success",
    blockNumber: result === null ? null : number,
    timestampSec: result === null ? null : timestampSec,
    detail,
  });
  console.log(`[${step}] ${description} -> ${result === null ? "n/a" : result.reverted ? "REVERTED" : result.hash}`);
}

function tokenBalanceOf(account: string): bigint {
  const [bal] = castCall(TOKEN, "balanceOf(address)(uint256)", [account]);
  if (bal === undefined) throw new Error(`could not read balanceOf(${account})`);
  return BigInt(bal);
}

// Measured live while building this script: `cast send ... --from WHALE --unlocked` against
// this specific real, heavily-used whale address ALWAYS actually lands the transfer, but the
// client consistently fails to report success (same underlying flaky-RPC pattern as
// elsewhere in this file, but 100% reproducible here rather than intermittent — see
// docs/API_NOTES.md). Retrying-until-success (this function's first draft) silently
// over-funded the target by repeating the transfer on every "failed" retry. Fixed: try once,
// and treat any error as informational — verify the real outcome via the recipient's actual
// balance delta, which is the only thing that matters here, rather than trusting the client's
// own success/failure report for this specific call shape.
function fundFromWhale(to: string, amount: string): void {
  const before = tokenBalanceOf(to);
  rpc("anvil_impersonateAccount", [WHALE]);
  rpc("anvil_setBalance", [WHALE, "0x56BC75E2D63100000"]);
  try {
    execFileSync("cast", ["send", TOKEN, "transfer(address,uint256)", to, amount, "--from", WHALE, "--unlocked", "--rpc-url", RPC_URL], { encoding: "utf8" });
  } catch {
    // Expected — see comment above. Verified below, not assumed.
  }
  rpc("anvil_stopImpersonatingAccount", [WHALE]);
  const after = tokenBalanceOf(to);
  if (after - before !== BigInt(amount)) {
    throw new Error(`fundFromWhale: expected balance to increase by ${amount}, actually increased by ${after - before}`);
  }
}

// Fork-only. If the real vault's NAV is stale, re-sets it at the UNCHANGED price by
// impersonating the real NAV manager and calling the vault's own setNAV, so only
// priceUpdatedAt moves (a zero change also passes the vault's deviation guard). Skipped when
// the NAV is fresh, so a run after IXS updates the NAV involves no intervention at all.
// Returns true if it refreshed.
function refreshStaleVaultNav(): boolean {
  const [updatedAt] = castCall(VAULT, "priceUpdatedAt()(uint256)");
  const [threshold] = castCall(VAULT, "navStalenessThreshold()(uint256)");
  const [price] = castCall(VAULT, "pricePerShare()(uint256)");
  if (updatedAt === undefined || threshold === undefined || price === undefined) {
    throw new Error("could not read the vault's NAV freshness fields");
  }
  const { timestampSec } = blockInfo();
  if (BigInt(threshold) === 0n || BigInt(timestampSec) - BigInt(updatedAt) <= BigInt(threshold)) return false;

  rpc("anvil_impersonateAccount", [NAV_MANAGER]);
  rpc("anvil_setBalance", [NAV_MANAGER, "0x56BC75E2D63100000"]);
  try {
    execFileSync("cast", ["send", VAULT, "setNAV(uint256)", price, "--from", NAV_MANAGER, "--unlocked", "--rpc-url", RPC_URL], { encoding: "utf8" });
  } catch {
    // Same unreliable client report as fundFromWhale; the outcome is verified below.
  }
  rpc("anvil_stopImpersonatingAccount", [NAV_MANAGER]);

  const [newUpdatedAt] = castCall(VAULT, "priceUpdatedAt()(uint256)");
  const [newPrice] = castCall(VAULT, "pricePerShare()(uint256)");
  if (newPrice !== price || newUpdatedAt === updatedAt) {
    throw new Error(`refreshStaleVaultNav: expected a fresh timestamp at unchanged price ${price}, got price ${newPrice}, updatedAt ${newUpdatedAt}`);
  }
  return true;
}

const DEPOSIT_SIG = "deposit(uint128,uint64,bytes32,uint32,bytes)";
const LOG_DECISION_SIG = "logDecision(uint64,bytes32,uint8,uint32,bytes)";

function main(): void {
  console.log(`Deployed addresses: ${JSON.stringify(addr, null, 2)}`);

  // --- Agent A: T0 -> T1 graduation ---
  // Self-funded here (mirrors Agent B's fundFromWhale below) so the whole pipeline is
  // actually single-command reproducible. A first draft left this as a manual step ("see
  // this script's header for the exact cast commands" — LIVE.md's own words), but no such
  // commands ever existed in the header; caught only when re-running the full demo from a
  // freshly re-pinned fork (the original pinned block had aged out of the upstream RPC's
  // archive window, a separate real finding) and hitting a real
  // OverCapacity revert on an unfunded account.
  fundFromWhale(addr.accountA, "500000000000000000000"); // 500 units, matches LIVE.md's documented funding amount
  record("A_fund", "Agent A's account funded with 500 units (whale impersonation, local fork only)", null);

  if (refreshStaleVaultNav()) {
    record(
      "FORK_nav_refresh",
      "Real vault's NAV was stale (maxDeposit = 0 for everyone); re-set at the unchanged price via the real NAV manager, fork only",
      null,
    );
  }

  const initialDeposit = "100000000000000000000"; // 100e18, above T0's 90e18 peak requirement
  record(
    "A_deposit_1",
    "Agent A deposits 100 units — sets peakExposure above T0's 90-unit requirement",
    robustSend(
      addr.accountA, DEPOSIT_SIG,
      () => [initialDeposit, nextSeqOf(addr.accountA), receiptHash("A deposit 1"), "0", "0x"],
      PK.agentA, () => nextSeqOf(addr.accountA),
    ),
  );

  for (let i = 0; i < 9; i++) {
    record(
      `A_receipt_${i + 2}`,
      "Agent A logs a HOLD decision — accumulating toward T0's 10-receipt minimum",
      robustSend(
        addr.accountA, LOG_DECISION_SIG,
        () => [nextSeqOf(addr.accountA), receiptHash(`A receipt ${i + 2}`), "0", "0", "0x"],
        PK.agentA, () => nextSeqOf(addr.accountA),
      ),
    );
  }

  const beforeGraduate = castCall(addr.accountA, "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)");
  console.log(`Agent A tier state before dwell/graduate: tier=${beforeGraduate[0]} receiptsSinceEntry=${beforeGraduate[4]}`);

  // T0's minDwellUnits=10 * DEMO_TIME_UNIT_SECONDS=60 = 600s. 700s clears it with margin.
  record("A_warp_time", "Fork clock advanced 700s (past T0's 600s minimum dwell) via evm_increaseTime", null);
  rpc("evm_increaseTime", ["700"]);
  rpc("evm_mine");

  record(
    "A_graduate",
    "Agent A calls graduate() — all six T0 promotion conditions now hold on-chain",
    robustSend(addr.accountA, "graduate()", () => [], PK.agentA, () => tierOf(addr.accountA)),
  );

  const afterGraduate = castCall(addr.accountA, "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)");
  console.log(`Agent A tier state after graduate(): tier=${afterGraduate[0]}`);
  if (afterGraduate[0] !== "1") {
    throw new Error(`expected Agent A to reach tier 1, got tier ${afterGraduate[0]}`);
  }

  // --- Agent B: fresh stranger, created AFTER Agent A already has a graduation history ---
  const mandateB = [
    "1200000000000000000000", "10000", "1200000000000000000000", "0", "100",
    String(Math.floor(Date.now() / 1000) + 365 * 86400), "86400", "0", "0", "0", "14", "1200000000000000000000",
  ].join(",");
  const envelopeB = "1200000000000000000000,1200000000000000000000,0,false";
  const createArgs = [ADDR_B.owner, ADDR_B.agent, ADDR_B.guardian, "1200000000000000000000", `(${mandateB})`, `(${envelopeB})`, "0"];

  const createSig = "createAccount(address,address,address,uint128,(uint128,uint16,uint128,uint128,uint32,uint40,uint32,uint16,uint16,uint16,uint32,uint128),(uint128,uint128,uint128,bool),uint8)";
  const createResult = robustSend(
    addr.factory, createSig, () => createArgs, PK.deployer,
    () => accountsCountOf(addr.registry, ADDR_B.agent),
  );
  record("B_create", "Agent B (fresh stranger, no conduct record) created via StewardFactory", createResult);

  // Find Agent B's address from the factory's AccountCreated event, filtered by agent
  // (topics[3], the 3rd indexed address param) rather than by this specific tx's hash — the
  // robustSend recovery path above may have landed via an earlier attempt than the one whose
  // hash we have, or (rarely) hash may be null entirely (recovered case), so a receipt lookup
  // on createResult.hash alone isn't reliable here.
  // --from-block matters, not just as an optimization: without it, `cast logs` scans from
  // genesis on a ~123-million-block chain, which reliably needs archive access and was the
  // actual root cause of this call failing far more often than every other RPC call in this
  // script (retries alone couldn't fix a query that's *always* out of the free tier's range —
  // see docs/API_NOTES.md). Scoping to the fork's own pinned starting block fixes it properly.
  const pinnedBlock = readFileSync(".fork-state/pinned-block.txt", "utf8").trim();
  const accountCreatedTopic = receiptHash("AccountCreated(address,address,address,uint8)");
  const agentTopic = `0x${"0".repeat(24)}${ADDR_B.agent.slice(2).toLowerCase()}`;
  const logsOut = withRetry(() =>
    execFileSync("cast", ["logs", accountCreatedTopic, "--address", addr.factory, "--from-block", pinnedBlock, "--to-block", "latest", "--rpc-url", RPC_URL, "--json"], { encoding: "utf8" }),
  );
  const matchingLog = (JSON.parse(logsOut) as { topics: string[] }[]).find((l) => l.topics[3]?.toLowerCase() === agentTopic);
  const accountB: string | undefined = matchingLog !== undefined ? `0x${matchingLog.topics[1]!.slice(26)}` : undefined;
  if (accountB === undefined) throw new Error("could not find Agent B's address in AccountCreated event logs");
  console.log(`Agent B account: ${accountB}`);

  fundFromWhale(accountB, "250000000000000000000"); // 250 units, plenty of headroom for T0-scale actions
  record("B_fund", "Agent B's account funded with 250 units (whale impersonation, local fork only)", null);

  // --- The contrast: same deposit amount, two agents ---
  const contrastAmount = "200000000000000000000"; // 200e18: within A's T1 maxTx (300e18), above B's T0 maxTx (120e18)

  record(
    "A_contrast_deposit",
    "Agent A (T1, maxTx 300 units) deposits 200 units — should SUCCEED",
    robustSend(
      addr.accountA, DEPOSIT_SIG,
      () => [contrastAmount, nextSeqOf(addr.accountA), receiptHash("A contrast deposit"), "0", "0x"],
      PK.agentA, () => nextSeqOf(addr.accountA),
    ),
  );

  record(
    "B_contrast_deposit",
    "Agent B (T0, maxTx 120 units) attempts the SAME 200-unit deposit — should REVERT (OverMaxTx)",
    robustSend(
      accountB, DEPOSIT_SIG,
      () => [contrastAmount, nextSeqOf(accountB), receiptHash("B contrast deposit"), "0", "0x"],
      PK.agentB, () => nextSeqOf(accountB), true,
    ),
    "expected revert: OverMaxTx — Agent B's tier (T0, earned nothing yet) caps it at 120 units regardless of mandate ceiling",
  );

  mkdirSync(".demo-state", { recursive: true });
  writeFileSync(".demo-state/receipts.json", JSON.stringify({ addresses: { ...addr, accountB }, receipts }, null, 2) + "\n");
  console.log("\nWrote .demo-state/receipts.json");
  console.log("\nSummary: Agent A graduated T0->T1 and successfully deposited 200 units.");
  console.log("Agent B (fresh stranger) was rejected attempting the identical 200-unit deposit at T0.");
}

main();
