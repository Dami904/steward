import { NextRequest, NextResponse } from "next/server";
import { readAccountState, fetchAccountHistory } from "@/lib/chain";
import { replayHistory } from "@/lib/replay";
import { isHostedDeployment, resolveForkRpc } from "@/lib/deployment";

// Phase 6, sixth item (spec/DECISIONS.md): a paid version of /verify's own replay logic,
// exposed as a server-side API route so it has something for x402 (a server-side HTTP gate)
// to actually gate — /verify itself runs entirely client-side (no server round-trip at all),
// so there was nothing to charge for until this route existed. Reuses lib/chain.ts and
// lib/replay.ts unchanged — same verification logic /verify already uses and this repo's own
// differential suite already agrees with, not a second implementation to keep in sync.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("account");
  const requestedRpc = searchParams.get("rpcUrl");
  const startTier = Number(searchParams.get("startTier") ?? "0");
  const fromBlockParam = searchParams.get("fromBlock");

  // Hosted deployments ignore rpcUrl and read only the operator's FORK_RPC_URL (SSRF guard,
  // lib/deployment.ts), so there it is optional.
  if (address === null || (requestedRpc === null && !isHostedDeployment())) {
    return NextResponse.json({ ok: false, error: "account and rpcUrl query params are required" }, { status: 400 });
  }
  const rpcUrl = resolveForkRpc(requestedRpc);
  if (rpcUrl === null) {
    return NextResponse.json({ ok: false, error: "No demo chain is hosted on this deployment." }, { status: 503 });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "account must be a 0x-prefixed 20-byte address" }, { status: 400 });
  }
  if (!Number.isFinite(startTier) || startTier < 0) {
    return NextResponse.json({ ok: false, error: "startTier must be a non-negative integer" }, { status: 400 });
  }

  let fromBlock: bigint;
  try {
    fromBlock = fromBlockParam !== null ? BigInt(fromBlockParam) : 0n;
  } catch {
    return NextResponse.json({ ok: false, error: "fromBlock must be a valid integer" }, { status: 400 });
  }

  const typedAddress = address as `0x${string}`;
  try {
    const accountState = await readAccountState(rpcUrl, typedAddress);
    const events = await fetchAccountHistory(rpcUrl, typedAddress, fromBlock);
    const replay = await replayHistory(rpcUrl, events, startTier, accountState.tierState.tier);
    return NextResponse.json({ ok: true, account: address, replay });
  } catch (err) {
    // A bad rpcUrl/account (unreachable RPC, nonexistent contract) is the caller's input
    // error, not this server's fault — 502 (upstream/RPC failure) rather than 500, matching
    // this route's role as a proxy onto an external chain read, not a self-contained compute.
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
