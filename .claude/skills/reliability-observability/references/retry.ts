/**
 * Retry with exponential backoff — but it refuses to retry a write unless
 * you tell it explicitly that the call is idempotent. This is the one
 * guardrail that matters: a retry wrapper with no opinion on idempotency
 * is how a transient network blip turns into a duplicate payout.
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  /** Only retry errors this returns true for (default: network/5xx-shaped errors). */
  isRetryable?: (err: unknown) => boolean;
  /**
   * Must be set to true explicitly for any non-GET call. This is the
   * confirmation that the call is idempotent (via an idempotency key, or
   * because it's genuinely side-effect-free) — see idempotency.ts.
   */
  isIdempotent: boolean;
}

const defaultIsRetryable = (err: unknown): boolean => {
  if (err instanceof Error) {
    // network-level failures and 5xx are worth retrying; 4xx generally isn't
    const msg = err.message.toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      /5\d\d/.test(msg)
    );
  }
  return false;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!options.isIdempotent) {
    throw new Error(
      "withRetry: isIdempotent must be explicitly true. Wrap the call with " +
        "an idempotency key first (see idempotency.ts) before retrying a write.",
    );
  }

  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 500;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !isRetryable(err)) throw err;
      const delay = baseDelay * 2 ** attempt + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
