import { test } from "node:test";
import assert from "node:assert/strict";
import { chatCompletion } from "../src/client.ts";

function mockFetch(handler: (input: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("rejects a request with no system/developer message before making any call", async () => {
  let called = false;
  const fetchImpl = mockFetch(() => {
    called = true;
    return jsonResponse(200, {});
  });
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }], fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("returns content on a well-formed 2xx response", async () => {
  const fetchImpl = mockFetch(() =>
    jsonResponse(200, { choices: [{ message: { content: "hello" } }] }),
  );
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.content, "hello");
});

test("does not retry a 4xx (request-shape error)", async () => {
  let calls = 0;
  const fetchImpl = mockFetch(() => {
    calls++;
    return jsonResponse(400, { error: "bad request" });
  });
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl, maxAttempts: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

test("retries a 5xx up to maxAttempts, then fails", async () => {
  let calls = 0;
  const fetchImpl = mockFetch(() => {
    calls++;
    return jsonResponse(503, { error: "unavailable" });
  });
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl, maxAttempts: 3,
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 3);
});

test("succeeds after one 5xx retry", async () => {
  let calls = 0;
  const fetchImpl = mockFetch(() => {
    calls++;
    if (calls === 1) return jsonResponse(503, { error: "unavailable" });
    return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
  });
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl, maxAttempts: 3,
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("a network error (thrown by fetch) is treated as a failure, not an unhandled rejection", async () => {
  const fetchImpl = mockFetch(() => {
    throw new Error("ECONNRESET");
  });
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl, maxAttempts: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /NETWORK_ERROR/);
});

test("a hung request is aborted at timeoutMs and reported as a timeout, not left pending", async () => {
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl, timeoutMs: 20, maxAttempts: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /TIMEOUT/);
});

test("a malformed response body (no choices[0].message.content) is a failure, not a thrown error", async () => {
  const fetchImpl = mockFetch(() => jsonResponse(200, { unexpected: "shape" }));
  const result = await chatCompletion({
    apiKey: "k", model: "m", messages: [{ role: "system", content: "sys" }], fetchImpl,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /MALFORMED_RESPONSE/);
});

// SERV accepts OpenAI strict json_schema output (one live call, 2026-09-26, docs/API_NOTES.md).
// Without it the live model wrote "hold" for "HOLD" in 8 of 10 policy-arm calls.
test("sends response_format only when the caller passes responseFormat", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = mockFetch((_url, init) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return jsonResponse(200, { choices: [{ message: { content: "{}" } }] });
  });
  const format = { type: "json_schema", json_schema: { name: "x", strict: true, schema: { type: "object" } } };
  await chatCompletion({ apiKey: "k", model: "m", messages: [{ role: "system", content: "s" }], fetchImpl, responseFormat: format });
  await chatCompletion({ apiKey: "k", model: "m", messages: [{ role: "system", content: "s" }], fetchImpl });
  assert.deepEqual(bodies[0]?.["response_format"], format);
  assert.equal("response_format" in (bodies[1] ?? {}), false);
});
