import { createPublicClient, http, type PublicClient } from "viem";
import { stewardAccountAbi, erc20BalanceAbi } from "./steward-abi";

// BSC mainnet chain id (56) — a local fork of it reports the same id, which is exactly what
// Phase 4's persistent fork does (scripts/fork-node.sh). Not hardcoded to a specific RPC: the
// verifier is meant to be pointed at whatever endpoint the caller provides — a local fork
// during development, or a real BSC RPC once/if this repo's zero-funds decision is revisited

export function client(rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: { id: 56, name: "BSC", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
    transport: http(rpcUrl),
  });
}

export interface OnChainAccountState {
  nextSeq: bigint;
  hardCap: bigint;
  owner: `0x${string}`;
  agent: `0x${string}`;
  guardian: `0x${string}`;
  exposure: bigint;
  totalDeposited: bigint;
  tierState: {
    tier: number;
    tierEnteredAt: number;
    riskAcc: bigint;
    peakExposure: bigint;
    receiptsSinceEntry: number;
    incidentCount: number;
    lastIncidentAt: number;
    lastExposure: bigint;
    lastTs: number;
    incidentsSinceEntry: number;
  };
  mandate: {
    maxTxUsdc: bigint;
    maxBps: number;
    maxVaultUsdc: bigint;
    minLiquidUsdc: bigint;
    maxActionsPerDay: number;
    expiry: number;
    loosenDelay: number;
    issuerHaircutBps: number;
    latencyHaircutBpsPerDay: number;
    latencyHaircutMaxBps: number;
    leadFloorDays: number;
    approvalAbove: bigint;
  };
  envelope: {
    capacityCap: bigint;
    capCeiling: bigint;
    reserveUsdc: bigint;
    paused: boolean;
  };
  usdcAddress: `0x${string}`;
  liquidBalance: bigint;
  loosenPending: boolean;
  pendingLoosenCap: bigint;
  loosenProposedAt: number;
  shareTokenAddress: `0x${string}`;
  shareBalance: bigint;
}

export async function readAccountState(rpcUrl: string, address: `0x${string}`): Promise<OnChainAccountState> {
  const c = client(rpcUrl);
  const [
    nextSeq,
    hardCap,
    owner,
    agent,
    guardian,
    exposure,
    totalDeposited,
    tierStateRaw,
    mandateRaw,
    envelopeRaw,
    usdcAddress,
    loosenPending,
    pendingLoosenCap,
    loosenProposedAt,
    shareTokenAddress,
  ] = await Promise.all([
    c.readContract({ address, abi: stewardAccountAbi, functionName: "nextSeq" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "hardCap" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "owner" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "agent" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "guardian" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "exposure" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "totalDeposited" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "tierState" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "mandate" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "envelope" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "usdc" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "loosenPending" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "pendingLoosenCap" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "loosenProposedAt" }),
    c.readContract({ address, abi: stewardAccountAbi, functionName: "shareToken" }),
  ]);

  const [tier, tierEnteredAt, riskAcc, peakExposure, receiptsSinceEntry, incidentCount, lastIncidentAt, lastExposure, lastTs, incidentsSinceEntry] = tierStateRaw;
  const [
    maxTxUsdc,
    maxBps,
    maxVaultUsdc,
    minLiquidUsdc,
    maxActionsPerDay,
    expiry,
    loosenDelay,
    issuerHaircutBps,
    latencyHaircutBpsPerDay,
    latencyHaircutMaxBps,
    leadFloorDays,
    approvalAbove,
  ] = mandateRaw;
  const [capacityCap, capCeiling, reserveUsdc, paused] = envelopeRaw;

  const [liquidBalance, shareBalance] = await Promise.all([
    c.readContract({ address: usdcAddress, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] }),
    c.readContract({ address: shareTokenAddress, abi: erc20BalanceAbi, functionName: "balanceOf", args: [address] }),
  ]);

  return {
    nextSeq,
    hardCap,
    owner,
    agent,
    guardian,
    exposure,
    totalDeposited,
    tierState: {
      tier,
      tierEnteredAt,
      riskAcc,
      peakExposure,
      receiptsSinceEntry,
      incidentCount,
      lastIncidentAt,
      lastExposure,
      lastTs,
      incidentsSinceEntry,
    },
    mandate: {
      maxTxUsdc,
      maxBps,
      maxVaultUsdc,
      minLiquidUsdc,
      maxActionsPerDay,
      expiry,
      loosenDelay,
      issuerHaircutBps,
      latencyHaircutBpsPerDay,
      latencyHaircutMaxBps,
      leadFloorDays,
      approvalAbove,
    },
    envelope: { capacityCap, capCeiling, reserveUsdc, paused },
    usdcAddress,
    liquidBalance,
    loosenPending,
    pendingLoosenCap,
    loosenProposedAt,
    shareTokenAddress,
    shareBalance,
  };
}

export async function readNextSeq(rpcUrl: string, address: `0x${string}`): Promise<bigint> {
  return client(rpcUrl).readContract({ address, abi: stewardAccountAbi, functionName: "nextSeq" });
}

// setMandate has no seq check and replaces the whole struct — MandateBuilder.tsx only lets
// the user edit 8 of 12 fields and carries the other 4 through unchanged, so it must read
// those 4 fresh immediately before submitting, not from the page's SSR'd (possibly minutes-
// stale, since the user may spend real time filling in the form) `state` prop. A first draft
// used the stale prop value directly — a real TOCTOU gap: any legitimate concurrent change to
// one of the 4 carried-through fields between page load and "Confirm & sign" would have been
// silently clobbered back to its old value, since setMandate overwrites the entire struct.
export async function readMandateCarryThroughFields(
  rpcUrl: string,
  address: `0x${string}`,
): Promise<{ issuerHaircutBps: number; latencyHaircutBpsPerDay: number; latencyHaircutMaxBps: number; leadFloorDays: number }> {
  const mandateRaw = await client(rpcUrl).readContract({ address, abi: stewardAccountAbi, functionName: "mandate" });
  const [, , , , , , , issuerHaircutBps, latencyHaircutBpsPerDay, latencyHaircutMaxBps, leadFloorDays] = mandateRaw;
  return { issuerHaircutBps, latencyHaircutBpsPerDay, latencyHaircutMaxBps, leadFloorDays };
}

export interface RawEvent {
  kind: "Decision" | "Graduated" | "Demoted" | "LoosenProposed" | "LoosenCancelled" | "LoosenApplied";
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  args: Record<string, unknown>;
}

// eth_getLogs range limits are real and vendor-specific (docs/API_NOTES.md: the public BSC
// RPC this project has used rejects wide/old ranges without an archive token). This function
// surfaces that error rather than swallowing it — the caller decides what to tell the user,
// per this project's "fail visibly, don't guess" pattern (the same lesson
// learned the hard way in scripts/demo-driver.ts).
export async function fetchAccountHistory(
  rpcUrl: string,
  address: `0x${string}`,
  fromBlock: bigint,
): Promise<RawEvent[]> {
  const c = client(rpcUrl);
  const abiEvents = stewardAccountAbi.filter((e) => e.type === "event");

  const logs = await c.getLogs({
    address,
    events: abiEvents,
    fromBlock,
    toBlock: "latest",
  });

  return logs.map((log) => ({
    kind: log.eventName as RawEvent["kind"],
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    args: log.args as Record<string, unknown>,
  }));
}

export async function currentBlockNumber(rpcUrl: string): Promise<bigint> {
  return client(rpcUrl).getBlockNumber();
}

export async function blockTimestamp(rpcUrl: string, blockNumber: bigint): Promise<number> {
  const block = await client(rpcUrl).getBlock({ blockNumber });
  return Number(block.timestamp);
}
