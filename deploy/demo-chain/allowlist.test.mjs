import { test } from "node:test";
import assert from "node:assert/strict";
import { rejectReason } from "./allowlist.mjs";

// If the allowlist is removed or loosened, anyone could rewrite the public demo chain.
test("state-changing and cheat methods are refused", () => {
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "anvil_setBalance",
    "anvil_setStorageAt",
    "anvil_impersonateAccount",
    "anvil_reset",
    "anvil_loadState",
    "evm_revert",
    "evm_snapshot",
    "evm_mine",
    "evm_increaseTime",
    "hardhat_setBalance",
    "debug_traceTransaction",
    "personal_sign",
  ]) {
    const r = rejectReason({ jsonrpc: "2.0", id: 7, method, params: [] });
    assert.ok(r, `${method} must be refused`);
    assert.equal(r.error.code, -32601);
    assert.equal(r.id, 7);
  }
});

test("reads the web app uses are allowed", () => {
  for (const method of ["eth_chainId", "eth_blockNumber", "eth_call", "eth_getLogs", "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_getCode"]) {
    assert.equal(rejectReason({ jsonrpc: "2.0", id: 1, method, params: [] }), null, method);
  }
});

test("malformed requests are refused", () => {
  assert.ok(rejectReason(null));
  assert.ok(rejectReason("eth_call"));
  assert.ok(rejectReason([{ method: "eth_call" }]));
  assert.ok(rejectReason({ id: 1 }));
});
