// Low-level HTTP transport for SERV's OpenAI-compatible chat completions endpoint.
// docs/API_NOTES.md has what's actually been measured (base URL, auth, the
// max_tokens-vs-max_completion_tokens gotcha, and — as of a 2026-09-22 `live-serv-probe` run
// by the repo owner — real latency figures and a burst-of-5 rate-limit spot check). Retry
// tuning under a real 5xx and the exact timeout boundary remain unmeasured (no 5xx or timeout
// occurred live yet) — this agent does not read .env, so it cannot obtain SERV_API_KEY to
// probe them itself (the repo's rule: don't read .env or secrets). Every
// still-unmeasured value below is a clearly-labeled ASSUMPTION, not a fact — see
// scripts/live-serv-probe.ts, which the repo owner runs (with their own key) to replace each
// remaining assumption with a measured value in docs/API_NOTES.md.
//
// This is deliberately safe to build ahead of full measurement: nothing here ever throws
// past its own boundary, and every failure mode (timeout, network error, non-2xx, malformed
// body) returns a typed failure rather than a thrown exception — the caller (reasoner.ts /
// extraction.ts) turns any failure into a fail-closed HOLD or a stale-evidence result, never
// a guess. Getting the timeout/retry *tuning* wrong in either direction costs latency or
// SERV credits, never safety.

export interface ChatMessage {
  role: "system" | "developer" | "user";
  content: string;
}

export interface ChatCompletionParams {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  // ASSUMPTION: docs/API_NOTES.md confirms the default catalog model rejects `max_tokens`
  // and requires `max_completion_tokens` instead; passing it through unconditionally here
  // rather than guessing which models need which name.
  maxCompletionTokens?: number;
  // Sent as OpenAI-style `response_format`, e.g. reasoner.ts's PROPOSAL_RESPONSE_FORMAT.
  // MEASURED (docs/API_NOTES.md, 2026-09-26): SERV accepts strict json_schema and the model
  // then returns the exact enum casing. It helps the model; validateProposal is still the guard.
  responseFormat?: unknown;
  baseUrl?: string; // default below; overridable for the probe script and tests
  // PARTIALLY MEASURED (docs/API_NOTES.md, 2026-09-22 live-serv-probe run): real observed
  // latencies ranged ~0.68s-6.1s across 7 live calls (short and ~60-completion-token
  // requests) — comfortably under 30s, so this default has real headroom, not just a guess.
  // The boundary itself (does SERV ever legitimately take >30s) is still unmeasured; no
  // request came close to timing out live.
  timeoutMs?: number;
  // ASSUMPTION (still unmeasured live — no 5xx occurred during the 2026-09-22 probe run):
  // retry only on network failure or 5xx (a 4xx is a request-shape bug on our side — see the
  // max_tokens example in docs/API_NOTES.md — retrying it wastes a call and never succeeds).
  // 2 attempts total, no backoff measured/tuned yet.
  maxAttempts?: number;
  fetchImpl?: typeof fetch; // injected in tests; defaults to the global fetch
}

export type ChatCompletionResult =
  | { ok: true; content: string; raw: unknown }
  | { ok: false; reason: string };

const DEFAULT_BASE_URL = "https://inference-api.openserv.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;

export async function chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
  const baseUrl = params.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const doFetch = params.fetchImpl ?? fetch;

  // docs/API_NOTES.md: "every request needs a system or developer role message or the API
  // rejects it" — checked here so a malformed caller fails loudly before spending a call,
  // not silently after a wasted round trip.
  if (!params.messages.some((m) => m.role === "system" || m.role === "developer")) {
    return { ok: false, reason: "REQUEST_INVALID: no system/developer role message present" };
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (params.maxCompletionTokens !== undefined) body["max_completion_tokens"] = params.maxCompletionTokens;
  if (params.responseFormat !== undefined) body["response_format"] = params.responseFormat;

  let lastReason = "UNKNOWN_FAILURE";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const bodyText = await safeText(response);
        lastReason = `HTTP_${response.status}: ${bodyText.slice(0, 500)}`;
        // ASSUMPTION: retry 5xx (transient), never retry 4xx (our request is malformed;
        // retrying can't fix that and would waste SERV credits on an identical failure).
        if (response.status >= 500 && attempt < maxAttempts) continue;
        return { ok: false, reason: lastReason };
      }

      const json = (await response.json()) as unknown;
      const content = extractContent(json);
      if (content === undefined) {
        return { ok: false, reason: "MALFORMED_RESPONSE: no message content found in response body" };
      }
      return { ok: true, content, raw: json };
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastReason = isAbort ? `TIMEOUT after ${timeoutMs}ms` : `NETWORK_ERROR: ${String(err)}`;
      if (attempt < maxAttempts) continue;
      return { ok: false, reason: lastReason };
    }
  }
  return { ok: false, reason: lastReason };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}

// OpenAI-compatible shape: choices[0].message.content. Defensive about the exact structure
// since this is exactly the kind of thing docs/API_NOTES.md flags as needing a live check —
// returns undefined (never throws) on any shape mismatch, which the caller treats as failure.
function extractContent(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const choices = (json as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as unknown;
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : undefined;
}
