// The "same request, two agents" demo on the public BSC testnet (chain 97), so every step is a
// transaction anyone can open on testnet.bscscan.com. Same sequence as scripts/demo-driver.ts
// (the real-vault fork run, LIVE.md), with three differences a public chain forces:
// - The vault is this repo's mock (contracts/script/DeployTestnet.s.sol): the real IXS vault
//   exists only on BSC mainnet. Its USDC is a mock anyone can mint.
// - Time is real: the script waits out T0's 600 s minimum dwell instead of warping the clock.
// - Agent B's refused deposit is sent with a fixed gas limit so it is mined and fails on-chain
//   (OverMaxTx), instead of being stopped at gas estimation where nobody could see it.
//
// Keys are fresh throwaway testnet keys in .testnet/keys.json (gitignored, created by
// `pnpm run deploy:testnet-keys`), never Anvil's public dev keys, which bots drain on public
// testnets. Only addresses are ever printed.
//
// Usage:
//   pnpm run deploy:testnet-keys   # once: creates keys, prints the deployer address to fund
//   (fund that address with test BNB from a BSC testnet faucet; about 0.02 tBNB is plenty)
//   pnpm run deploy:testnet-demo   # deploys, runs the demo (~12 min), writes deploy/testnet/run.json
//   If a run dies (e.g. a network drop), continue it with --resume: every step checks the chain
//   first and skips what already landed. A plain rerun deploys a fresh stack instead.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { outcomeMismatch, receiptSucceeded } from "./testnet-outcome.ts";
import { needsContrastA, needsCreateB, needsFirstDeposit, needsFundB, needsGraduation, receiptSeqsLeft } from "./testnet-resume.ts";

const RPC = process.env["TESTNET_RPC_URL"] || "https://bsc-testnet-rpc.publicnode.com"; // || so an empty .env line falls back too
const CHAIN_ID = "97";
const EXPLORER = "https://testnet.bscscan.com";
const KEYS_PATH = ".testnet/keys.json";
const DEPLOYED_PATH = "deploy/testnet/deployed.json";
const RUN_PATH = "deploy/testnet/run.json";
const ROLES = ["deployer", "ownerA", "agentA", "guardianA", "ownerB", "agentB", "guardianB"] as const;
type Role = (typeof ROLES)[number];
type Keys = Record<Role, { address: string; privateKey: string }>;

const UNIT = 10n ** 18n;
const DEPOSIT_SIG = "deposit(uint128,uint64,bytes32,uint32,bytes)";
const LOG_DECISION_SIG = "logDecision(uint64,bytes32,uint8,uint32,bytes)";
const TIER_STATE_SIG = "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)";
const CREATE_SIG =
  "createAccount(address,address,address,uint128,(uint128,uint16,uint128,uint128,uint32,uint40,uint32,uint16,uint16,uint16,uint32,uint128),(uint128,uint128,uint128,bool),uint8)";
const T0_MIN_DWELL_SECONDS = 600; // T0 minDwellUnits 10 x DEMO_TIME_UNIT_SECONDS 60

// Private keys are passed to cast as arguments, and a failed child process's error message
// repeats its whole command line, so every failure is rethrown with keys redacted.
const secrets: string[] = [];
function redact(text: string): string {
  return secrets.reduce((t, s) => t.split(s).join("[redacted]"), text);
}
function cast(args: string[]): string {
  try {
    return execFileSync("cast", [...args, "--rpc-url", RPC], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(redact(`cast ${args[0]} failed: ${e.stderr || e.stdout || e.message || String(err)}`));
  }
}
// Reads only (chain id, balances, calls, block time) are retried: repeating a read is always
// safe, and one dropped connection during the 10-minute dwell wait ended a real run
// (2026-09-26). Sends go through cast() once: a send that errored may still have landed.
function read(args: string[]): string {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return cast(args);
    } catch (err) {
      last = err;
      if (attempt < 4) execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${attempt * 3000})`]);
    }
  }
  throw last;
}
function first(out: string): string {
  return out.split("\n")[0]!.trim().split(/\s+/)[0]!;
}
function call(to: string, sig: string, args: string[] = []): string[] {
  return read(["call", to, sig, ...args]).split("\n").map((l) => l.trim().split(/\s+/)[0]!);
}
function hashOf(label: string): string {
  return execFileSync("cast", ["keccak", label], { encoding: "utf8" }).trim();
}

interface Receipt { status: string; transactionHash: string; blockNumber: string; logs: { topics: string[] }[] }
function send(to: string, sig: string, args: string[], pk: string, extra: string[] = []): Receipt {
  // sig === "" is a plain native-token transfer: cast takes no signature argument then.
  // BSC testnet: base fee 0, and BNB Chain's own nodes reject a 1-wei priority fee ("minimum
  // needed 100000000"), which in turn exceeds cast's 1-wei max-fee estimate. Legacy transactions
  // at a fixed 0.1 gwei avoid both, and are what BSC nodes expect.
  const out = cast(["send", to, ...(sig === "" ? [] : [sig, ...args]), "--private-key", pk, "--json", "--legacy", "--gas-price", "100000000", ...extra]);
  const parsed = JSON.parse(out) as Receipt | { data: Receipt };
  return "data" in parsed ? parsed.data : parsed;
}

const steps: { step: string; description: string; txHash: string | null; status: "success" | "reverted" | "info"; block: number | null; link: string | null }[] = [];
// Rewritten after every step, so a run that dies midway still leaves every landed tx on disk
// ("complete": false) for reconciling against the explorer.
const run: Record<string, unknown> = { complete: false };
function saveRun(): void {
  writeFileSync(RUN_PATH, JSON.stringify({ ...run, steps }, null, 2) + "\n");
}
function record(step: string, description: string, r: Receipt | null, expectRevert = false): void {
  const ok = r === null ? true : receiptSucceeded(r.status);
  const mismatch = r === null ? null : outcomeMismatch(step, r.status, expectRevert, r.transactionHash);
  if (mismatch !== null) {
    saveRun();
    throw new Error(mismatch);
  }
  steps.push({
    step,
    description,
    txHash: r?.transactionHash ?? null,
    status: r === null ? "info" : ok ? "success" : "reverted",
    block: r === null ? null : Number(r.blockNumber),
    link: r === null ? null : `${EXPLORER}/tx/${r.transactionHash}`,
  });
  saveRun();
  console.log(`[${step}] ${description}${r === null ? "" : ` -> ${ok ? "ok" : "REVERTED"} ${EXPLORER}/tx/${r.transactionHash}`}`);
}

function loadKeys(): Keys {
  if (!existsSync(KEYS_PATH)) throw new Error(`${KEYS_PATH} missing: run \`pnpm run deploy:testnet-keys\` first`);
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8")) as Keys;
  for (const r of ROLES) secrets.push(keys[r].privateKey, keys[r].privateKey.replace(/^0x/, ""));
  return keys;
}

function makeKeys(): void {
  if (!existsSync(KEYS_PATH)) {
    const out = JSON.parse(execFileSync("cast", ["wallet", "new", "--number", String(ROLES.length), "--json"], { encoding: "utf8" }));
    const wallets = (Array.isArray(out) ? out : out.data) as { address: string; private_key: string }[];
    if (wallets.length !== ROLES.length) throw new Error(`cast wallet new returned ${wallets.length} wallets`);
    const keys = Object.fromEntries(ROLES.map((r, i) => [r, { address: wallets[i]!.address, privateKey: wallets[i]!.private_key }])) as Keys;
    mkdirSync(".testnet", { recursive: true });
    writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
    console.log(`Created ${KEYS_PATH} (gitignored; throwaway BSC testnet keys only).`);
  }
  const keys = loadKeys();
  for (const r of ROLES) console.log(`${r.padEnd(10)} ${keys[r].address}`);
  console.log(`\nFund the deployer with test BNB (about 0.02 tBNB): ${keys.deployer.address}`);
}

function balanceWei(addr: string): bigint {
  return BigInt(read(["balance", addr]));
}

// The StewardAccount the factory created for this agent, from its AccountCreated event
// (topics: account, owner, agent), or null if there is none since the deploy block.
function findAccountFor(factory: string, agent: string, fromBlock: number): string | null {
  const topic = hashOf("AccountCreated(address,address,address,uint8)");
  const agentTopic = `0x${"0".repeat(24)}${agent.slice(2).toLowerCase()}`;
  // Public RPCs cap eth_getLogs ranges (10,000 blocks on dRPC, 50,000 on publicnode), so scan
  // in chunks. cast wraps --json output as { data: [...] } and exits non-zero on failure.
  const latest = Number(first(read(["block-number"])));
  const CHUNK = 5000;
  for (let from = fromBlock; from <= latest; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, latest);
    const out = JSON.parse(read(["logs", topic, "--address", factory, "--from-block", String(from), "--to-block", String(to), "--json"])) as
      | { topics: string[] }[]
      | { data: { topics: string[] }[] | null };
    const logs = Array.isArray(out) ? out : (out.data ?? []);
    const match = logs.find((l) => l.topics[3]?.toLowerCase() === agentTopic);
    if (match !== undefined) return `0x${match.topics[1]!.slice(26)}`;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}


// A fresh run: moves any unfinished previous run aside (a complete one needs --again), then
// deploys the stack. forge signs with TESTNET_DEPLOYER_PK from the environment, never a
// command-line argument, so its output (not passed through redact()) has no key to echo.
async function deployFresh(keys: Keys): Promise<Record<string, string | number>> {
  if (existsSync(RUN_PATH)) {
    const previous = JSON.parse(readFileSync(RUN_PATH, "utf8")) as { complete?: boolean };
    if (previous.complete === true && !process.argv.includes("--again")) {
      throw new Error(`${RUN_PATH} already records a complete run; rerun with --again to replace it`);
    }
    const aside = `deploy/testnet/previous-${Date.now()}`;
    mkdirSync(aside, { recursive: true });
    for (const f of [RUN_PATH, DEPLOYED_PATH]) if (existsSync(f)) renameSync(f, `${aside}/${f.split("/").pop()}`);
    console.log(`Moved the previous run's files to ${aside}/ (resume it instead with --resume)`);
  }
  Object.assign(run, {
    network: "BSC testnet (chain 97)",
    explorer: EXPLORER,
    vault: "mock (contracts/test/mocks/MockManagedVault.sol); the real IXS vault is on BSC mainnet only, see LIVE.md for the real-vault fork run",
    ranAt: new Date().toISOString(),
  });
  saveRun();
  console.log("Deploying the stack (forge script DeployTestnet)...");
  execFileSync("forge", ["script", "script/DeployTestnet.s.sol", "--rpc-url", RPC, "--broadcast", "--slow"], {
    cwd: "contracts",
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      TESTNET_DEPLOYER_PK: keys.deployer.privateKey,
      TESTNET_OWNER_A: keys.ownerA.address,
      TESTNET_AGENT_A: keys.agentA.address,
      TESTNET_GUARDIAN_A: keys.guardianA.address,
    },
  });
  const d = JSON.parse(readFileSync(DEPLOYED_PATH, "utf8")) as Record<string, string | number>;
  run["addresses"] = { ...d, agentA: keys.agentA.address };
  record("deploy", `Stack deployed; Agent A's account ${String(d["accountA"])} created at T0 and funded with 500 mock USDC`, null);
  return d;
}

async function runDemo(): Promise<void> {
  const chainId = read(["chain-id"]);
  if (chainId !== CHAIN_ID) throw new Error(`refusing to run: RPC is chain ${chainId}, this script only targets BSC testnet (97)`);
  const keys = loadKeys();

  const need = 10n ** 16n; // 0.01 tBNB: a run uses ~0.0015 to deploy, plus up to 0.007 of agent gas the first time
  const have = balanceWei(keys.deployer.address);
  if (have < need) {
    throw new Error(`deployer ${keys.deployer.address} holds ${Number(have) / 1e18} tBNB; fund it with at least 0.01 tBNB from a BSC testnet faucet first`);
  }

  // Gas for the two agents that send transactions (owners and guardians send none here).
  for (const [role, amount] of [["agentA", "5000000000000000"], ["agentB", "2000000000000000"]] as const) {
    if (balanceWei(keys[role].address) < BigInt(amount) / 2n) {
      send(keys[role].address, "", [], keys.deployer.privateKey, ["--value", amount]);
    }
  }

  // --resume continues an unfinished run from its on-chain state: every step below first checks
  // the chain (nextSeq, tier, balances) and skips what already landed, so nothing is sent twice.
  // Without --resume, a rerun deploys a fresh stack. A completed public run is never overwritten
  // silently (pass --again to replace it); an aborted run's files are moved aside, not lost.
  const resume = process.argv.includes("--resume");
  let d: Record<string, string | number>;
  if (resume) {
    if (!existsSync(RUN_PATH) || !existsSync(DEPLOYED_PATH)) throw new Error("--resume needs an unfinished run's deploy/testnet/run.json and deployed.json");
    const previous = JSON.parse(readFileSync(RUN_PATH, "utf8")) as Record<string, unknown> & { complete?: boolean; steps?: typeof steps };
    if (previous.complete === true) throw new Error(`${RUN_PATH} is already complete; nothing to resume`);
    const { steps: prevSteps, ...rest } = previous;
    Object.assign(run, rest);
    steps.push(...(prevSteps ?? []));
    d = JSON.parse(readFileSync(DEPLOYED_PATH, "utf8")) as Record<string, string | number>;
    console.log(`Resuming the unfinished run (${steps.length} steps already recorded)`);
  } else {
    d = await deployFresh(keys);
  }
  const accountA = String(d["accountA"]);
  const factory = String(d["factory"]);
  const usdc = String(d["usdc"]);

  const seq = (acct: string) => call(acct, "nextSeq()(uint64)")[0]!;
  const tier = (acct: string) => call(acct, TIER_STATE_SIG)[0]!;

  if (needsFirstDeposit(Number(seq(accountA)))) {
    record(
      "A_deposit_1",
      "Agent A deposits 100 (clears T0's 90-unit peak requirement)",
      send(accountA, DEPOSIT_SIG, [String(100n * UNIT), "1", hashOf("A deposit 1"), "0", "0x"], keys.agentA.privateKey),
    );
  }
  for (const n of receiptSeqsLeft(Number(seq(accountA)), Number(tier(accountA)))) {
    record(
      `A_receipt_${n}`,
      "Agent A logs a HOLD decision (T0 needs 10 receipts)",
      send(accountA, LOG_DECISION_SIG, [String(n), hashOf(`A receipt ${n}`), "0", "0", "0x"], keys.agentA.privateKey),
    );
  }

  if (needsGraduation(Number(tier(accountA)))) {
    // Real time on a public chain: wait until chain time passes tierEnteredAt + T0's dwell.
    // A failed read here only means "check again": nothing is sent while waiting.
    const enteredAt = Number(call(accountA, TIER_STATE_SIG)[1]);
    const readyAt = enteredAt + T0_MIN_DWELL_SECONDS + 30;
    for (;;) {
      let now: number;
      try {
        now = Number(first(read(["block", "latest", "--field", "timestamp"])));
      } catch {
        console.log("Chain time read failed (network); retrying in 30s");
        await sleep(30_000);
        continue;
      }
      if (now >= readyAt) break;
      console.log(`Waiting out T0's minimum dwell: ${readyAt - now}s left (chain time)`);
      await sleep(Math.min(30, readyAt - now) * 1000);
    }
    record("A_dwell", `Waited out T0's ${T0_MIN_DWELL_SECONDS}s minimum dwell in real chain time`, null);
    record("A_graduate", "Anyone calls graduate(): all six T0 conditions hold, Agent A goes T0 -> T1", send(accountA, "graduate()", [], keys.agentA.privateKey));
  }
  if (tier(accountA) !== "1") throw new Error(`expected Agent A at tier 1 after graduate(), got ${tier(accountA)}`);

  // Found on-chain, not taken from run.json: a create that landed before a crash (so never
  // recorded) must be picked up, not sent again.
  let accountB = findAccountFor(factory, keys.agentB.address, Number(d["deployBlock"]));
  if (accountB !== null && (run["addresses"] as Record<string, string> | undefined)?.["accountB"] === undefined) {
    run["addresses"] = { ...(run["addresses"] as object), accountB, agentB: keys.agentB.address };
    record("B_create", `Agent B's account found on-chain from an earlier attempt: ${accountB}`, null);
  }
  if (needsCreateB(accountB)) {
    const expiry = String(Math.floor(Date.now() / 1000) + 365 * 86400);
    const mandate = ["1200000000000000000000", "10000", "1200000000000000000000", "0", "100", expiry, "86400", "0", "0", "0", "14", "1200000000000000000000"].join(",");
    const envelope = "1200000000000000000000,1200000000000000000000,0,false";
    const created = send(
      factory,
      CREATE_SIG,
      [keys.ownerB.address, keys.agentB.address, keys.guardianB.address, "1200000000000000000000", `(${mandate})`, `(${envelope})`, "0"],
      keys.deployer.privateKey,
    );
    const createdTopic = hashOf("AccountCreated(address,address,address,uint8)");
    const log = created.logs.find((l) => l.topics[0]?.toLowerCase() === createdTopic.toLowerCase());
    if (log === undefined) throw new Error("AccountCreated event not found in Agent B's creation receipt");
    accountB = `0x${log.topics[1]!.slice(26)}`;
    run["addresses"] = { ...(run["addresses"] as object), accountB, agentB: keys.agentB.address };
    record("B_create", `Agent B (a stranger with no record) created at T0: ${accountB}`, created);
  }
  if (accountB === null) throw new Error("Agent B's account was not created");
  if (needsFundB(BigInt(call(usdc, "balanceOf(address)(uint256)", [accountB])[0]!), 200n * UNIT)) {
    record("B_fund", "Agent B's account funded with 250 mock USDC", send(usdc, "mint(address,uint256)", [accountB, String(250n * UNIT)], keys.deployer.privateKey));
  }

  const amount = String(200n * UNIT);
  if (needsContrastA(Number(seq(accountA)))) {
    record(
      "A_contrast_deposit",
      "Agent A (T1, max 300 per deposit) deposits 200: succeeds",
      send(accountA, DEPOSIT_SIG, [amount, "11", hashOf("A contrast deposit"), "0", "0x"], keys.agentA.privateKey),
    );
  }
  // Confirm the reason before sending, then force the tx on-chain so the revert is public.
  let reason = "unknown";
  try {
    read(["call", accountB, DEPOSIT_SIG, amount, seq(accountB), hashOf("B contrast deposit"), "0", "0x", "--from", keys.agentB.address]);
  } catch (err) {
    reason = /OverMaxTx|0x[0-9a-f]{8}/i.exec(String(err))?.[0] ?? "reverted";
  }
  record(
    "B_contrast_deposit",
    `Agent B (T0, max 120 per deposit) tries the same 200: reverts on-chain (${reason})`,
    send(accountB, DEPOSIT_SIG, [amount, seq(accountB), hashOf("B contrast deposit"), "0", "0x"], keys.agentB.privateKey, ["--gas-limit", "400000"]),
    true,
  );

  run["complete"] = true;
  saveRun();
  console.log(`\nWrote ${RUN_PATH}. Agent A: ${EXPLORER}/address/${accountA}  Agent B: ${EXPLORER}/address/${accountB}`);
}

const mode = process.argv[2];
if (mode === "keys") makeKeys();
else if (mode === "run") {
  try {
    await runDemo();
  } catch (err) {
    console.error(redact(err instanceof Error ? (err.stack ?? err.message) : String(err)));
    process.exit(1);
  }
} else {
  console.error("usage: node --experimental-strip-types scripts/testnet-demo.ts keys|run");
  process.exit(1);
}
