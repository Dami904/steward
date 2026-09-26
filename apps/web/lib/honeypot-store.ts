// Public notice inbox storage for the honeypot (serv PLAN_v3.md section 9.1: "A public
// 'notice inbox' accepts text (max 2 KB, rate-limited, sanitized) that enters the untrusted
// notes for the next cycle.") — the storage/rate-limit half only. What "enters the untrusted
// notes for the next cycle" means in the full plan is a live SERV-driven agent actually
// reading these and proposing actions from them; this repo has no such live orchestrator
// wired up (docs/LIMITATIONS.md's SERV integration section — no orchestrator populates real
// policyInput, and running one here would mean live, billed SERV_API_KEY calls from an agent
// session, which this repo's CLAUDE.md rule keeps out of the default path). So: submissions
// are collected for real, sanitized and rate-limited for real, but not live-processed this
// session — stated plainly on the page itself, not silently implied.
//
// File-backed (a JSON file under apps/web/.honeypot-data/, gitignored), not a database —
// this process runs as one long-lived Node process (`next dev`/`next start`), matching this
// repo's existing pattern for small local state (.fork-state/, .demo-state/). Rate limiting
// is an in-memory token bucket keyed by a hashed IP — resets on server restart, not
// distributed across multiple instances. Both are real, working limits for a single-process
// hackathon deployment, not dressed up as more than that.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".honeypot-data");
const NOTICES_FILE = join(DATA_DIR, "notices.json");

export const MAX_NOTICE_BYTES = 2048; // serv PLAN_v3.md section 9.1: "max 2 KB"
const MAX_NOTICES_KEPT = 500; // bounds file growth over a judging period without needing a real database
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

export interface Notice {
  id: string;
  text: string;
  submittedAt: string; // ISO
  submitterHash: string; // sha256 of the rate-limit key — never the raw IP, kept only so repeat submitters are visible without storing anything identifying
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readNotices(): Notice[] {
  ensureDataDir();
  if (!existsSync(NOTICES_FILE)) return [];
  try {
    const raw = readFileSync(NOTICES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupted/partially-written file is a data problem, not a reason to crash every
    // request that touches the inbox — fail to an empty inbox and let new submissions
    // overwrite it, rather than 500ing the whole honeypot page.
    return [];
  }
}

function writeNotices(notices: Notice[]): void {
  ensureDataDir();
  writeFileSync(NOTICES_FILE, JSON.stringify(notices, null, 2), "utf-8");
}

// Strips control characters and collapses anything that isn't printable text. React escapes
// text content by default (nothing here is ever rendered via dangerouslySetInnerHTML), so
// this isn't an XSS defense — it's about keeping stored notices to the "text" the plan
// describes, not arbitrary bytes.
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX_PER_WINDOW) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart) };
  }
  bucket.count += 1;
  return { allowed: true };
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  notice?: Notice;
}

export function submitNotice(rawText: string, rateLimitKey: string): SubmitResult {
  if (typeof rawText !== "string" || rawText.trim() === "") {
    return { ok: false, error: "Notice text is empty." };
  }
  const byteLength = Buffer.byteLength(rawText, "utf-8");
  if (byteLength > MAX_NOTICE_BYTES) {
    return { ok: false, error: `Notice is ${byteLength} bytes, over the ${MAX_NOTICE_BYTES}-byte limit.` };
  }

  const rl = checkRateLimit(rateLimitKey);
  if (!rl.allowed) {
    return { ok: false, error: `Rate limited — try again in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s.` };
  }

  const text = sanitize(rawText);
  if (text === "") {
    return { ok: false, error: "Notice text is empty after sanitization." };
  }

  const notice: Notice = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    text,
    submittedAt: new Date().toISOString(),
    submitterHash: hashKey(rateLimitKey).slice(0, 16),
  };

  const notices = readNotices();
  notices.push(notice);
  while (notices.length > MAX_NOTICES_KEPT) notices.shift();
  writeNotices(notices);

  return { ok: true, notice };
}

export function listNotices(limit = 50): Notice[] {
  const notices = readNotices();
  return notices.slice(-limit).reverse();
}
