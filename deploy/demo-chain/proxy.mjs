// Read-only JSON-RPC front for the hosted demo chain.
//
// Starts Anvil on loopback with the committed demo state (state.json: the demo run, made
// self-contained so no upstream BSC RPC is needed) and forwards only read methods to it
// (allowlist.mjs). Anvil exposes cheat methods and accepts any transaction, so a public Anvil
// would let anyone rewrite the demo's state; everything off the allowlist is refused here.
//
// The HTTP port opens immediately so the host's health check passes during Anvil's startup;
// RPC calls get 503 until Anvil answers. No dependencies: node:http + global fetch.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rejectReason, rpcError } from "./allowlist.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const ANVIL_PORT = 8545;
const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 50;
const ANVIL_TIMEOUT_MS = 10_000;

let ready = false;

function log(level, msg, extra = {}) {
  (level === "error" ? console.error : console.log)(JSON.stringify({ level, msg, ...extra }));
}

async function forward(req) {
  const denied = rejectReason(req);
  if (denied) return denied;
  const res = await fetch(ANVIL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(ANVIL_TIMEOUT_MS),
  });
  return res.json();
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function send(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json", ...CORS, ...headers });
  res.end(JSON.stringify(body));
}

async function handleBody(res, raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, rpcError(null, -32700, "Parse error"));
  }
  if (!ready) return send(res, 503, rpcError(body?.id, -32603, "Demo chain is starting, retry shortly"), { "retry-after": "5" });
  try {
    if (Array.isArray(body)) {
      if (body.length === 0 || body.length > MAX_BATCH) return send(res, 400, rpcError(null, -32600, `Batch must have 1-${MAX_BATCH} requests`));
      return send(res, 200, await Promise.all(body.map(forward)));
    }
    return send(res, 200, await forward(body));
  } catch (err) {
    log("error", "anvil request failed", { err: String(err) });
    return send(res, 502, rpcError(body?.id, -32603, "Demo chain unavailable"));
  }
}

const server = createServer((req, res) => {
  req.on("error", (err) => {
    log("error", "request stream error", { err: String(err) });
    res.destroy();
  });
  if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
  if (req.method === "GET") return send(res, 200, { ok: true, ready, service: "steward demo chain (read-only)" });
  if (req.method !== "POST") return send(res, 405, rpcError(null, -32600, "POST JSON-RPC only"));

  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on("data", (c) => {
    if (tooLarge) return;
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      send(res, 413, rpcError(null, -32600, `Body over ${MAX_BODY_BYTES} bytes`), { connection: "close" });
      req.resume(); // drain the rest so the response can flush
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (!tooLarge) void handleBody(res, Buffer.concat(chunks).toString("utf8"));
  });
});

server.listen(PORT, () => log("info", "proxy listening", { port: PORT }));

const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(ANVIL_PORT), "--chain-id", "56", "--load-state", "state.json"], {
  stdio: ["ignore", "ignore", "inherit"],
});
anvil.on("error", (err) => {
  log("error", "anvil failed to start", { err: String(err) });
  process.exit(1);
});
anvil.on("exit", (code, signal) => {
  log("error", "anvil exited", { code, signal });
  process.exit(1);
});

for (let i = 0; i < 240 && !ready; i++) {
  try {
    const r = await fetch(ANVIL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}',
      signal: AbortSignal.timeout(2_000),
    });
    if (r.ok) {
      ready = true;
      log("info", "anvil ready", { block: Number((await r.json()).result) });
    }
  } catch {
    // not listening yet
  }
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  log("error", "anvil did not become ready");
  process.exit(1);
}
