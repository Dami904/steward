// Which JSON-RPC methods the hosted demo chain answers. Anvil also exposes cheat methods
// (anvil_setBalance, anvil_impersonateAccount, evm_revert, ...) and accepts any signed
// transaction, so anything not listed here is refused before it reaches Anvil.

export const READ_METHODS = new Set([
  "web3_clientVersion",
  "net_version",
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);

export function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// Returns an error response for a request that must not reach Anvil, or null if it may.
export function rejectReason(req) {
  if (typeof req !== "object" || req === null || Array.isArray(req)) return rpcError(null, -32600, "Invalid request");
  if (!READ_METHODS.has(req.method)) return rpcError(req.id, -32601, `Method not allowed on the read-only demo chain: ${String(req.method)}`);
  return null;
}
