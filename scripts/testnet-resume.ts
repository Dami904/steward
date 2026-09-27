// What scripts/testnet-demo.ts still has to send, decided from on-chain state only, so a run
// resumed after a crash (--resume) never sends a step twice. Pure functions so each guard has
// a test (scripts/testnet-resume.test.ts) that fails if it is removed.

// Agent A: nextSeq 1 = nothing sent; each deposit/logDecision advances it by one; after the
// first deposit and 9 receipts it is 11; after the contrast deposit, 12.
export const A_SEQ_AFTER_RECEIPTS = 11;

export function needsFirstDeposit(nextSeq: number): boolean {
  return nextSeq === 1;
}

// The seq numbers still to log as HOLD receipts (2..10), none once graduated.
export function receiptSeqsLeft(nextSeq: number, tier: number): number[] {
  if (tier !== 0) return [];
  const out: number[] = [];
  for (let n = Math.max(nextSeq, 2); n < A_SEQ_AFTER_RECEIPTS; n++) out.push(n);
  return out;
}

export function needsGraduation(tier: number): boolean {
  return tier === 0;
}

// B's account is found on-chain (the factory's AccountCreated log for agentB), never inferred
// from the local run file: a create that landed before a crash must not be sent again.
export function needsCreateB(existingAccountB: string | null): boolean {
  return existingAccountB === null;
}

export function needsFundB(balance: bigint, contrastAmount: bigint): boolean {
  return balance < contrastAmount;
}

export function needsContrastA(nextSeq: number): boolean {
  return nextSeq === A_SEQ_AFTER_RECEIPTS;
}
