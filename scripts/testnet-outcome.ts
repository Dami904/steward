// The demo's pass/fail rule for each transaction (scripts/testnet-demo.ts). The testnet run
// exists to show a public revert-vs-success contrast, so a step whose on-chain outcome is the
// opposite of what the demo claims must stop the run, never be written up as the demo.

export function receiptSucceeded(status: string): boolean {
  return status === "0x1" || status === "1";
}

// Returns an error message when the outcome contradicts the expectation, or null when it matches.
export function outcomeMismatch(step: string, status: string, expectRevert: boolean, txHash: string): string | null {
  if (receiptSucceeded(status) !== expectRevert) return null;
  return `${step}: expected ${expectRevert ? "a revert" : "success"}, got status ${status} (${txHash})`;
}
