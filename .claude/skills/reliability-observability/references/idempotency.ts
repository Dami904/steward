/**
 * Idempotency key helper.
 *
 * The rule this file exists to enforce: generate and PERSIST the key
 * before the request goes out, never after. If you only save the key once
 * a response comes back, a timeout on the request itself leaves you with
 * nothing to dedupe against — you can't tell "never sent" from "sent, lost
 * the response" from "sent twice."
 *
 * Swap `store` for your actual persistence (Postgres, Supabase, SQLite,
 * even a durable KV) — the interface is intentionally tiny.
 */

export interface IdempotencyStore {
  /** Insert a new pending record. Should fail/throw on key collision. */
  create(key: string, meta: Record<string, unknown>): Promise<void>;
  get(key: string): Promise<IdempotencyRecord | null>;
  update(key: string, patch: Partial<IdempotencyRecord>): Promise<void>;
}

export type ExecutionStatus = "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export interface IdempotencyRecord {
  key: string;
  status: ExecutionStatus;
  createdAt: string;
  result?: unknown;
  meta?: Record<string, unknown>;
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}

/**
 * Wraps a single external call with the persist-before-send pattern.
 *
 * - If a record for this key already exists and is CONFIRMED or FAILED,
 *   returns that instead of calling `fn` again — this is what makes a
 *   client-side retry safe.
 * - If it exists and is PENDING or UNKNOWN, that's a call that never got a
 *   definitive answer last time. Surface it for reconciliation instead of
 *   silently retrying — see references/reconciliation-pattern.md.
 * - On a new key: persist PENDING first, call `fn`, then persist the
 *   outcome. A crash between "persist PENDING" and "persist outcome"
 *   leaves a real, findable UNKNOWN record instead of nothing at all.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore,
  key: string,
  meta: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<{ status: ExecutionStatus; result?: T }> {
  const existing = await store.get(key);

  if (existing?.status === "CONFIRMED" || existing?.status === "FAILED") {
    return { status: existing.status, result: existing.result as T };
  }

  if (existing && (existing.status === "PENDING" || existing.status === "UNKNOWN")) {
    // Don't silently retry. The caller needs to reconcile this first.
    return { status: "UNKNOWN" };
  }

  await store.create(key, meta);

  try {
    const result = await fn();
    await store.update(key, { status: "CONFIRMED", result });
    return { status: "CONFIRMED", result };
  } catch (err) {
    // A thrown error here might still mean "the write went through and the
    // response was lost." Don't assume FAILED unless you have positive
    // proof (a 4xx you understand, a simulation revert). Default to
    // UNKNOWN and let reconciliation resolve it.
    const isDefinitiveFailure = err instanceof DefinitiveFailure;
    await store.update(key, { status: isDefinitiveFailure ? "FAILED" : "UNKNOWN" });
    throw err;
  }
}

/** Throw this specifically when you have positive proof the action did not
 * happen (e.g. a 400 with a validation error, a pre-flight simulation
 * revert). Any other error should be treated as UNKNOWN, not FAILED. */
export class DefinitiveFailure extends Error {}
