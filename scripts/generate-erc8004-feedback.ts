// Generates a spec-compliant ERC-8004 feedback payload (erc-8004/erc-8004-contracts'
// ERC8004SPEC.md) summarizing a StewardAccount's REAL on-chain conduct — current tier, the
// ConductRegistry's track record (max tier ever reached, incident count, clean-streak start),
// distinct owners seen — read via `cast call`, the same read-only pattern as
// scripts/live-health-snapshot.ts. No key or funded wallet needed.
//
// This script exists because the real ERC-8004
// ReputationRegistry.giveFeedback() explicitly reverts ("Self-feedback not allowed") if the
// feedback-giver is the account's own owner or agent (checked via
// IdentityRegistry.isAuthorizedOrOwner) — Steward can never legitimately call giveFeedback()
// about its own account. This generates the PAYLOAD an independent third party (a delegator
// evaluating whether to trust this agent, IXS itself, anyone but this account's own
// owner/agent) could review, adjust, and then submit themselves via
// giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
// — this script does not and cannot submit anything on their behalf, and deliberately doesn't
// try to: doing so from an address this project controls would just be self-feedback under a
// different name, which the real contract is specifically designed to reject.
//
// The suggested `value`/`valueDecimals` score is a documented, adjustable formula over the
// RAW on-chain fields this script also prints in full — a real reviewer should look at the
// raw numbers and adjust or replace the score, not trust it blindly; there is no canonical
// "correct" reputation score, on-chain or off.
//
// Usage: node --experimental-strip-types scripts/generate-erc8004-feedback.ts \
//   --account <StewardAccount address> --agent-id <uint> [--rpc-url URL] [--write path]
// Defaults to the local Phase 4 fork's own port convention if --rpc-url is omitted, since
// this project's own StewardAccount instances only ever exist there (zero-funds/fork-only
// path) — pass --rpc-url explicitly to point at anything else.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const ACCOUNT = arg("account");
const AGENT_ID = arg("agent-id");
if (ACCOUNT === undefined || AGENT_ID === undefined) {
  console.error("Usage: generate-erc8004-feedback.ts --account <address> --agent-id <uint> [--rpc-url URL] [--write path]");
  process.exit(1);
}

const FORK_PORT = process.env.FORK_PORT ?? "8546";
const RPC_URL = arg("rpc-url") ?? `http://127.0.0.1:${FORK_PORT}`;
const CAST_TIMEOUT_MS = 15_000; // docs/API_NOTES.md: bound the subprocess against a hung RPC ourselves

const REAL_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // BSC mainnet
const CHAIN_ID = 56; // BSC mainnet

function castCall(to: string, sig: string, ...args: string[]): string[] {
  const out = execFileSync("cast", ["call", to, sig, ...args, "--rpc-url", RPC_URL], { encoding: "utf8", timeout: CAST_TIMEOUT_MS });
  return out
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((v): v is string => v !== undefined);
}

function requireField<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`unexpected empty cast output for ${label}`);
  return v;
}

function main(): void {
  const [agentAddr] = castCall(ACCOUNT!, "agent()(address)");
  const [conductRegistryAddr] = castCall(ACCOUNT!, "conductRegistry()(address)");
  requireField(agentAddr, "agent()");
  requireField(conductRegistryAddr, "conductRegistry()");

  // Types.TierState's 10 fields, in declared order (contracts/src/libraries/Types.sol).
  const tierStateFields = castCall(
    ACCOUNT!,
    "tierState()(uint8,uint40,uint128,uint128,uint32,uint32,uint40,uint128,uint40,uint32)",
  );
  const [tier, tierEnteredAt, , , , tierStateIncidentCount, , , ,] = tierStateFields;
  requireField(tier, "tierState().tier");

  // ConductRegistry.Record's 7 fields, in declared order (contracts/src/ConductRegistry.sol).
  const recordFields = castCall(
    conductRegistryAddr!,
    "recordOf(address)(uint32,uint32,uint128,uint32,uint8,uint40,uint40)",
    agentAddr!,
  );
  const [accountsCount, distinctOwnersCount, totalRiskUnits, incidentCount, maxTierReached, firstSeen, cleanStreakStart] =
    recordFields;
  requireField(accountsCount, "recordOf().accountsCount");

  const nowSec = Math.floor(Date.now() / 1000);
  const cleanStreakDays = Math.max(0, (nowSec - Number(cleanStreakStart)) / 86400);
  const accountAgeDays = Math.max(0, (nowSec - Number(firstSeen)) / 86400);

  // Suggested score, 0-100, valueDecimals=0 — documented and adjustable, not authoritative.
  // Base: 25 points per tier currently held (T0=0 .. T3=75). Bonus: up to 20 points for a
  // clean streak, saturating at 90 days (matches spec/tiers.md's own multi-week-to-months
  // dwell-time scale for tier progression, so "long clean streak" and "high tier" are
  // measuring related but distinct things — a long-clean-but-still-T0 account and a
  // fast-graduated-but-recently-incident-hit account should score differently).
  // Penalty: 10 points per lifetime incident, uncapped downward past the tier+streak bonus
  // (a bad-enough incident history should be able to drag the score to 0 even at a high tier).
  const tierScore = Number(tier) * 25;
  const streakBonus = Math.min(20, Math.round((cleanStreakDays / 90) * 20));
  const incidentPenalty = Number(incidentCount) * 10;
  const suggestedValue = Math.max(0, Math.min(100, tierScore + streakBonus - incidentPenalty));

  const createdAt = new Date(nowSec * 1000).toISOString();
  const feedback = {
    agentRegistry: `eip155:${CHAIN_ID}:${REAL_IDENTITY_REGISTRY}`,
    agentId: AGENT_ID,
    // Placeholder — the real submitter's own address, filled in by whoever actually calls
    // giveFeedback(). Left blank here since this script has no legitimate address to put:
    // filling it with anything this project controls would just be self-feedback again.
    clientAddress: `eip155:${CHAIN_ID}:<FILL IN THE REVIEWING THIRD PARTY'S OWN ADDRESS>`,
    createdAt,
    value: suggestedValue,
    valueDecimals: 0,
    tag1: "steward-agent-conduct",
    tag2: `tier-${tier}`,
    endpoint: `steward-account:${ACCOUNT}`,
  };
  const feedbackJson = JSON.stringify(feedback, null, 2);
  // Ethereum's keccak256 (the ORIGINAL Keccak, not NIST-standardized SHA3 — they differ in
  // padding and produce different digests) — `cast keccak` is the correct primitive here,
  // Node's own `crypto.createHash("sha3-256")` would silently produce the wrong hash.
  const feedbackHash = execFileSync("cast", ["keccak", feedbackJson], { encoding: "utf8", timeout: CAST_TIMEOUT_MS }).trim();

  const report = {
    fetchedAt: createdAt,
    rpcUrl: RPC_URL,
    account: ACCOUNT,
    agent: agentAddr,
    conductRegistry: conductRegistryAddr,
    rawOnChainConduct: {
      currentTier: Number(tier),
      tierEnteredAt: Number(tierEnteredAt),
      tierStateIncidentCount: Number(tierStateIncidentCount), // TierState's own field, distinct from ConductRegistry's lifetime incidentCount below
      accountsCount: Number(accountsCount),
      distinctOwnersCount: Number(distinctOwnersCount),
      totalRiskUnits: totalRiskUnits,
      lifetimeIncidentCount: Number(incidentCount),
      maxTierEverReached: Number(maxTierReached),
      firstSeen: Number(firstSeen),
      accountAgeDays: Math.round(accountAgeDays * 10) / 10,
      cleanStreakStart: Number(cleanStreakStart),
      cleanStreakDays: Math.round(cleanStreakDays * 10) / 10,
    },
    suggestedScoreFormula: "25*currentTier + min(20, round(90-day-saturating cleanStreakDays/90*20)) - 10*lifetimeIncidentCount, clamped [0,100]",
    feedbackPayload: feedback,
    // NOTE: feedbackHash here is keccak256 of THIS JSON string as printed — correct only if
    // the reviewing third party hosts this exact byte-for-byte file at feedbackURI without
    // re-serializing it (e.g. via a JSON.stringify with different key order/whitespace, which
    // would produce a different hash). ERC8004SPEC.md: "feedbackHash is the KECCAK-256 hash of
    // the content referenced by feedbackURI" — for IPFS/content-addressed hosting, the spec
    // says this field is OPTIONAL and can be omitted instead, which sidesteps this fragility.
    feedbackHashNote:
      "keccak256 of feedbackPayload's exact JSON serialization above — invalidated by re-serializing with different formatting; prefer omitting for IPFS-hosted content per ERC8004SPEC.md",
    feedbackHashOfPrintedPayload: feedbackHash,
  };

  console.log(JSON.stringify(report, null, 2));

  const outPath = arg("write");
  if (outPath !== undefined) {
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.error(`\nwrote ${outPath}`);
  }
}

main();
