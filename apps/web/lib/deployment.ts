// Where this app is running decides which RPC the fork-backed pages (/verify, /app,
// /honeypot, /demo, /api/verify-paid) may read.
//
// Locally, any ?rpc= URL is honored: pointing the verifier at a chain of your choice is the
// point of a verifier. On a hosted deployment those reads run on the server, so honoring a
// visitor-supplied URL would let anyone make the server fetch arbitrary addresses (SSRF).
// There, only the operator-set FORK_RPC_URL is used, and with none set the pages say the fork
// isn't hosted instead of trying 127.0.0.1 on a machine where nothing listens.

export const LOCAL_FORK_RPC = "http://127.0.0.1:8546"; // scripts/fork-node.sh's fixed port

type Env = Partial<Record<string, string>>;

// Vercel sets VERCEL=1 at build time and at runtime.
export function isHostedDeployment(env: Env = process.env): boolean {
  return env["VERCEL"] === "1";
}

function configuredForkRpc(env: Env): string | null {
  const url = env["FORK_RPC_URL"]?.trim();
  return url ? url : null;
}

// Returns the RPC URL to read, or null when this deployment has no fork to read.
export function resolveForkRpc(requested: string | null | undefined, env: Env = process.env): string | null {
  if (isHostedDeployment(env)) return configuredForkRpc(env);
  const fromRequest = requested?.trim();
  return fromRequest || configuredForkRpc(env) || LOCAL_FORK_RPC;
}

// lib/honeypot-store.ts keeps notices in a local JSON file. Vercel's filesystem is read-only,
// so hosted deployments show the inbox as closed rather than failing on every request.
export function honeypotStoreWritable(env: Env = process.env): boolean {
  return !isHostedDeployment(env);
}
