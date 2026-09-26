// The committed demo run (deploy/demo-chain/snapshot.json, bundled at build time): the chain a
// hosted deployment reads. Pages use it to open on Agent A instead of an empty form when a
// visitor arrives without an address.
import snapshot from "../../../deploy/demo-chain/snapshot.json";

export const DEMO_ACCOUNT_A = snapshot.addresses.accountA;
// One block after the fork pin: every demo event is in a local block above it (see /demo).
export const DEMO_FROM_BLOCK = (BigInt(snapshot.pinnedBlock) + 1n).toString();
