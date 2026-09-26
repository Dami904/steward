import { NextRequest, NextResponse } from "next/server";
import { submitNotice, listNotices, hashKey, MAX_NOTICE_BYTES } from "@/lib/honeypot-store";
import { honeypotStoreWritable } from "@/lib/deployment";

// Rate-limit key: NextRequest dropped the built-in `.ip` property in v15 — the standard
// replacement is the `x-forwarded-for` header a reverse proxy sets. Falls back to a fixed
// key when absent (a direct local connection with no proxy in front, e.g. `next dev`), which
// means every request shares one bucket in that case — an honest limitation of running
// without a real proxy in front, not a silent gap: documented here, not just in the effect.
function rateLimitKeyFor(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const key = forwardedFor?.split(",")[0]?.trim() || "no-forwarded-for-header";
  return hashKey(key);
}

const INBOX_CLOSED = { ok: false, error: "The notice inbox is closed on this hosted deployment; run the app locally to submit." };

export async function GET() {
  if (!honeypotStoreWritable()) return NextResponse.json({ notices: [] });
  return NextResponse.json({ notices: listNotices() });
}

export async function POST(request: NextRequest) {
  if (!honeypotStoreWritable()) return NextResponse.json(INBOX_CLOSED, { status: 503 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body === "object" && body !== null && "text" in body ? (body as { text: unknown }).text : undefined;
  if (typeof text !== "string") {
    return NextResponse.json({ ok: false, error: `Expected { "text": string }, at most ${MAX_NOTICE_BYTES} bytes.` }, { status: 400 });
  }

  const result = submitNotice(text, rateLimitKeyFor(request));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.error?.startsWith("Rate limited") ? 429 : 400 });
  }
  return NextResponse.json({ ok: true, notice: result.notice });
}
