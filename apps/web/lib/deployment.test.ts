import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_FORK_RPC, isHostedDeployment, resolveForkRpc, honeypotStoreWritable } from "./deployment.ts";

const LOCAL = {};
const HOSTED = { VERCEL: "1" };
const HOSTED_WITH_FORK = { VERCEL: "1", FORK_RPC_URL: "https://steward-fork.example.com" };

test("local: no ?rpc= falls back to the local fork", () => {
  assert.equal(resolveForkRpc(undefined, LOCAL), LOCAL_FORK_RPC);
  assert.equal(resolveForkRpc("   ", LOCAL), LOCAL_FORK_RPC);
});

test("local: ?rpc= is honored (pointing the verifier at any chain is a local feature)", () => {
  assert.equal(resolveForkRpc("http://127.0.0.1:8551", LOCAL), "http://127.0.0.1:8551");
});

test("local: FORK_RPC_URL replaces the default when no ?rpc= is given", () => {
  assert.equal(resolveForkRpc(undefined, { FORK_RPC_URL: "http://10.0.0.5:8546" }), "http://10.0.0.5:8546");
});

// The SSRF guard. On a hosted deployment the fetch runs on the server, so a visitor-supplied
// URL must never be used. If this guard is deleted, these assertions fail.
test("hosted: a visitor-supplied ?rpc= is never used", () => {
  assert.equal(resolveForkRpc("http://169.254.169.254/latest/meta-data", HOSTED), null);
  assert.equal(resolveForkRpc("http://169.254.169.254/latest/meta-data", HOSTED_WITH_FORK), "https://steward-fork.example.com");
});

test("hosted: no FORK_RPC_URL means no fork, not the localhost default", () => {
  assert.equal(resolveForkRpc(undefined, HOSTED), null);
  assert.equal(resolveForkRpc(undefined, { VERCEL: "1", FORK_RPC_URL: "  " }), null);
});

test("hosted: FORK_RPC_URL is used", () => {
  assert.equal(resolveForkRpc(undefined, HOSTED_WITH_FORK), "https://steward-fork.example.com");
});

test("isHostedDeployment reads Vercel's own VERCEL=1", () => {
  assert.equal(isHostedDeployment(LOCAL), false);
  assert.equal(isHostedDeployment(HOSTED), true);
  assert.equal(isHostedDeployment({ VERCEL: "0" }), false);
});

test("honeypot store is writable locally only (Vercel's filesystem is read-only)", () => {
  assert.equal(honeypotStoreWritable(LOCAL), true);
  assert.equal(honeypotStoreWritable(HOSTED), false);
});
