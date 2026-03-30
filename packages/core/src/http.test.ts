import { describe, it, expect } from "bun:test";
import { httpRequest } from "./http.js";
import type { FetchFn, HttpClientConfig, HttpRequestConfig, ErrorBodyParser } from "./http.js";
import type { CarrierResult } from "./index.js";

/**
 * Core HTTP client unit tests.
 *
 * Tests exercise httpRequest() directly with fake fetch functions.
 * Each test targets a specific behaviour or known bug from adversarial reviews.
 *
 * Known bugs these tests expose (should be RED until coder fixes them):
 *   C — parseErrorBody never sets `message`, so error body details are lost
 *   A — Double timeout via Promise.race + signal (leak risk, tested indirectly)
 *   I — Hardcoded "rating request" log label in generic HTTP module
 *   B — Retry-After as HTTP-date is ignored (only integer seconds work)
 */

// --- Helpers ---

function fakeResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function staticFetch(response: Response | (() => Response)): FetchFn {
  return async () => typeof response === "function" ? response() : response;
}

function sequenceFetch(
  responses: Array<() => Response | Promise<Response>>,
): { fetch: FetchFn; callCount: () => number; timestamps: () => number[] } {
  let calls = 0;
  const ts: number[] = [];

  const fetch: FetchFn = async () => {
    const idx = calls++;
    ts.push(Date.now());
    if (idx < responses.length) {
      return responses[idx]!();
    }
    return fakeResponse(200, { ok: true });
  };

  return { fetch, callCount: () => calls, timestamps: () => ts };
}

function baseConfig(fetch: FetchFn, overrides?: Partial<HttpClientConfig>): HttpClientConfig {
  return {
    fetch,
    maxAttempts: 4,
    baseDelayMs: 10,     // fast for tests
    timeoutMs: 1_000,
    maxRetryAfterSeconds: 5,
    ...overrides,
  };
}

const BASE_REQUEST: HttpRequestConfig = {
  url: "https://api.example.com/rate",
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer test" },
  body: JSON.stringify({ test: true }),
  carrier: "TestCarrier",
};

// --- Happy path ---

describe("httpRequest: success", () => {
  it("returns parsed JSON on 200", async () => {
    const payload = { RateResponse: { RatedShipment: [] } };
    const config = baseConfig(staticFetch(fakeResponse(200, payload)));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe(200);
    expect(result.data.json).toEqual(payload);
  });

  it("returns error when response body is not JSON", async () => {
    const config = baseConfig(staticFetch(textResponse(200, "OK")));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("JSON");
    expect(result.error.carrier).toBe("TestCarrier");
  });
});

// --- Error classification ---

describe("httpRequest: error classification", () => {
  it("returns AUTH error on 401", async () => {
    const body = { response: { errors: [{ code: "AUTH001", message: "Invalid token" }] } };
    const config = baseConfig(staticFetch(fakeResponse(401, body)));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH");
    expect(result.error.message).toContain("401");
  });

  it("returns RATE_LIMIT error on 429", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(429, {}, { "Retry-After": "999" }),  // exceeds max
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMIT");
    expect(callCount()).toBe(1); // no retry when Retry-After exceeds max
  });

  it("returns PROVIDER error on 4xx (not 401/429)", async () => {
    const config = baseConfig(staticFetch(fakeResponse(400, { error: "Bad Request" })));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PROVIDER");
    expect(result.error.message).toContain("400");
    expect(result.error.retriable).toBe(false);
  });

  it("returns PROVIDER error on 5xx with retriable=true", async () => {
    const { fetch } = sequenceFetch([
      () => fakeResponse(503, {}),
      () => fakeResponse(503, {}),
      () => fakeResponse(503, {}),
      () => fakeResponse(503, {}),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PROVIDER");
    expect(result.error.retriable).toBe(true);
  });

  it("uses carrier name from request in error", async () => {
    const config = baseConfig(staticFetch(fakeResponse(400, {})));
    const request = { ...BASE_REQUEST, carrier: "FedEx" };

    const result = await httpRequest(config, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.carrier).toBe("FedEx");
    expect(result.error.message).toContain("FedEx");
  });
});

// --- Retry behaviour ---

describe("httpRequest: retry", () => {
  it("retries on 500 and succeeds", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(500, {}),
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    expect(callCount()).toBe(2);
  });

  it("retries on network error and succeeds", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => { throw new TypeError("fetch failed"); },
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    expect(callCount()).toBe(2);
  });

  it("does not retry on 401", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(401, {}),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    expect(callCount()).toBe(1);
  });

  it("does not retry on 400", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(400, {}),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    expect(callCount()).toBe(1);
  });

  it("does not retry on 403", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(403, {}),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    expect(callCount()).toBe(1);
  });

  it("exhausts maxAttempts on persistent failure", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(500, {}),
      () => fakeResponse(500, {}),
      () => fakeResponse(500, {}),
      () => fakeResponse(500, {}),
      () => fakeResponse(500, {}),
    ]);
    const config = baseConfig(fetch, { maxAttempts: 3 });

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    expect(callCount()).toBe(3);
  });

  it("applies exponential backoff between retries", async () => {
    const { fetch, timestamps } = sequenceFetch([
      () => fakeResponse(500, {}),
      () => fakeResponse(500, {}),
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch, { baseDelayMs: 50 });

    await httpRequest(config, BASE_REQUEST);

    const ts = timestamps();
    expect(ts.length).toBe(3);
    const gap1 = ts[1]! - ts[0]!;  // baseDelay * 2^0 = 50ms
    const gap2 = ts[2]! - ts[1]!;  // baseDelay * 2^1 = 100ms
    expect(gap2).toBeGreaterThan(gap1);
  });
});

// --- 429 Retry-After handling ---

describe("httpRequest: Retry-After", () => {
  it("respects integer Retry-After header", async () => {
    const { fetch, timestamps } = sequenceFetch([
      () => fakeResponse(429, {}, { "Retry-After": "1" }),
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch);

    await httpRequest(config, BASE_REQUEST);

    const ts = timestamps();
    expect(ts.length).toBe(2);
    const gap = ts[1]! - ts[0]!;
    expect(gap).toBeGreaterThanOrEqual(900); // ~1 second with tolerance
  });

  it("stops retrying when Retry-After exceeds maxRetryAfterSeconds", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(429, {}, { "Retry-After": "60" }),
    ]);
    const config = baseConfig(fetch, { maxRetryAfterSeconds: 5 });

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMIT");
    expect(callCount()).toBe(1);
  });

  it("retries on 429 without Retry-After header using backoff", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(429, {}),
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    expect(callCount()).toBe(2);
  });

  // --- BUG B: Retry-After as HTTP-date is ignored ---

  it("respects Retry-After as HTTP-date format", async () => {
    // RFC 7231 allows Retry-After to be an HTTP-date, e.g. "Sun, 30 Mar 2026 12:00:00 GMT"
    // The current implementation only handles integer seconds.
    // Use a date 2 seconds in the future.
    const futureDate = new Date(Date.now() + 2000).toUTCString();
    const { fetch, timestamps } = sequenceFetch([
      () => fakeResponse(429, {}, { "Retry-After": futureDate }),
      () => fakeResponse(200, { ok: true }),
    ]);
    const config = baseConfig(fetch, { maxRetryAfterSeconds: 10 });

    const result = await httpRequest(config, BASE_REQUEST);

    // Should retry successfully (date is within maxRetryAfterSeconds)
    expect(result.ok).toBe(true);
    const ts = timestamps();
    expect(ts.length).toBe(2);
    // Should have waited approximately 2 seconds
    const gap = ts[1]! - ts[0]!;
    expect(gap).toBeGreaterThanOrEqual(1500);
  });
});

// --- Timeout ---

describe("httpRequest: timeout", () => {
  it("times out hanging requests and retries", async () => {
    let calls = 0;
    const fetch: FetchFn = async (_input, init) => {
      calls++;
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted", "AbortError"));
          return;
        }
        const timer = setTimeout(() => resolve(fakeResponse(200, {})), 30_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    };
    const config = baseConfig(fetch, { timeoutMs: 100, maxAttempts: 3, baseDelayMs: 10 });

    const start = Date.now();
    const result = await httpRequest(config, BASE_REQUEST);
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TIMEOUT");
    expect(result.error.message).toContain("timeout");
    expect(result.error.retriable).toBe(true);
    expect(calls).toBe(3); // exhausted all attempts
    expect(elapsed).toBeLessThan(5_000);
  });

  it("succeeds after timeout on first attempt", async () => {
    let calls = 0;
    const fetch: FetchFn = async (_input, init) => {
      calls++;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const timer = setTimeout(() => _resolve(fakeResponse(200, {})), 30_000);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }
      return fakeResponse(200, { recovered: true });
    };
    const config = baseConfig(fetch, { timeoutMs: 100, baseDelayMs: 10 });

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.json).toEqual({ recovered: true });
    expect(calls).toBe(2);
  });
});

// --- BUG C: parseErrorBody never extracts message ---

describe("httpRequest: error body parsing", () => {
  it("passes parsed error body to errorBodyParser", async () => {
    const errorBody = { response: { errors: [{ code: "E001", message: "Something broke" }] } };
    let parsedBody: unknown = null;
    let parsedStatus: number | null = null;

    const parser: ErrorBodyParser = (status, body) => {
      parsedStatus = status;
      parsedBody = body;
      return "E001: Something broke";
    };

    const config = baseConfig(staticFetch(fakeResponse(400, errorBody)));

    const result = await httpRequest(config, BASE_REQUEST, parser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // errorBodyParser should receive the parsed JSON body
    expect(parsedStatus).toBe(400);
    expect(parsedBody).toEqual(errorBody);
    // The parser's return value should appear in the error message
    expect(result.error.message).toContain("E001: Something broke");
  });

  it("includes parsed error detail in 401 error message", async () => {
    // BUG C: parseErrorBody returns { raw, message: null } — message is never
    // assigned from the parsed body. mapStatusToError receives null as bodyMessage,
    // so error bodies from 401 responses lose their detail.
    const errorBody = { response: { errors: [{ code: "AUTH01", message: "Token expired" }] } };
    const parser: ErrorBodyParser = (_status, body) => {
      const envelope = body as { response?: { errors?: Array<{ code: string; message: string }> } };
      const errors = envelope?.response?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        return errors.map(e => `${e.code}: ${e.message}`).join("; ");
      }
      return null;
    };

    const config = baseConfig(staticFetch(fakeResponse(401, errorBody)));

    const result = await httpRequest(config, BASE_REQUEST, parser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH");
    // The errorBodyParser's parsed message should appear, not just "Unauthorized"
    expect(result.error.message).toContain("AUTH01: Token expired");
  });

  it("includes parsed error detail in 5xx error message", async () => {
    const errorBody = { message: "Internal processing error" };
    const parser: ErrorBodyParser = (_status, body) => {
      const b = body as { message?: string };
      return b?.message ?? null;
    };

    // All attempts fail with 500
    const { fetch } = sequenceFetch([
      () => fakeResponse(500, errorBody),
      () => fakeResponse(500, errorBody),
      () => fakeResponse(500, errorBody),
      () => fakeResponse(500, errorBody),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST, parser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Error should include the parsed body detail, not just "HTTP error (500)"
    expect(result.error.message).toContain("Internal processing error");
  });

  it("extracts message from { message } shape without errorBodyParser", async () => {
    const config = baseConfig(staticFetch(fakeResponse(400, { message: "Invalid shipping address" })));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Invalid shipping address");
  });

  it("extracts message from { error: { message } } shape without errorBodyParser", async () => {
    const config = baseConfig(staticFetch(fakeResponse(400, { error: { message: "Bad request" } })));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Bad request");
  });

  it("extracts message from { error: string } shape without errorBodyParser", async () => {
    const config = baseConfig(staticFetch(fakeResponse(400, { error: "Something went wrong" })));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Something went wrong");
  });

  it("handles unparseable error response body gracefully", async () => {
    const config = baseConfig(staticFetch(textResponse(400, "Bad Request")));

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PROVIDER");
    expect(result.error.message).toContain("400");
  });
});

// --- BUG I: Hardcoded log label ---

describe("httpRequest: logging", () => {
  it("uses generic log label, not carrier-specific 'rating request'", async () => {
    const logMessages: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
    const logger = {
      debug(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "debug", msg, meta }); },
      info(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "info", msg, meta }); },
      warn(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "warn", msg, meta }); },
      error(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "error", msg, meta }); },
    };

    const config = baseConfig(staticFetch(fakeResponse(200, { ok: true })), { logger });

    await httpRequest(config, BASE_REQUEST);

    // The info-level log for the request should NOT say "rating request"
    // since this is the core HTTP module, not UPS-specific
    const infoLogs = logMessages.filter(l => l.level === "info");
    expect(infoLogs.length).toBeGreaterThan(0);

    const hasRatingLabel = infoLogs.some(l => l.msg === "rating request");
    expect(hasRatingLabel).toBe(false);

    // Should use a generic label like "http request" instead
    const hasGenericLabel = infoLogs.some(l => l.msg.includes("request") || l.msg.includes("http"));
    expect(hasGenericLabel).toBe(true);
  });

  it("includes URL and attempt number in log metadata", async () => {
    const logMessages: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
    const logger = {
      debug(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "debug", msg, meta }); },
      info(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "info", msg, meta }); },
      warn(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "warn", msg, meta }); },
      error(msg: string, meta?: Record<string, unknown>) { logMessages.push({ level: "error", msg, meta }); },
    };

    const config = baseConfig(staticFetch(fakeResponse(200, { ok: true })), { logger });

    await httpRequest(config, BASE_REQUEST);

    const infoLogs = logMessages.filter(l => l.level === "info");
    const requestLog = infoLogs[0];
    expect(requestLog).toBeDefined();
    expect(requestLog!.meta?.url).toBe("https://api.example.com/rate");
    expect(requestLog!.meta?.attempt).toBe(0);
  });
});

// --- Request construction ---

describe("httpRequest: request construction", () => {
  it("omits body from init when request.body is undefined", async () => {
    let capturedInit: RequestInit | undefined;
    const fetch: FetchFn = async (_input, init) => {
      capturedInit = init;
      return fakeResponse(200, { ok: true });
    };
    const config = baseConfig(fetch);
    const request: HttpRequestConfig = {
      url: "https://api.example.com/status",
      method: "GET",
      headers: { "Authorization": "Bearer test" },
      carrier: "TestCarrier",
      // no body
    };

    await httpRequest(config, request);

    expect(capturedInit).toBeDefined();
    expect(capturedInit!.method).toBe("GET");
    expect(capturedInit!.body).toBeUndefined();
  });

  it("includes body in init when request.body is defined", async () => {
    let capturedInit: RequestInit | undefined;
    const fetch: FetchFn = async (_input, init) => {
      capturedInit = init;
      return fakeResponse(200, { ok: true });
    };
    const config = baseConfig(fetch);

    await httpRequest(config, BASE_REQUEST);

    expect(capturedInit).toBeDefined();
    expect(capturedInit!.body).toBe(JSON.stringify({ test: true }));
  });

  it("passes headers from request config to fetch", async () => {
    let capturedInit: RequestInit | undefined;
    const fetch: FetchFn = async (_input, init) => {
      capturedInit = init;
      return fakeResponse(200, { ok: true });
    };
    const config = baseConfig(fetch);

    await httpRequest(config, BASE_REQUEST);

    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer test");
  });

  it("passes abort signal to fetch", async () => {
    let capturedInit: RequestInit | undefined;
    const fetch: FetchFn = async (_input, init) => {
      capturedInit = init;
      return fakeResponse(200, { ok: true });
    };
    const config = baseConfig(fetch);

    await httpRequest(config, BASE_REQUEST);

    expect(capturedInit!.signal).toBeDefined();
    expect(capturedInit!.signal).toBeInstanceOf(AbortSignal);
  });
});

// --- Edge cases ---

describe("httpRequest: edge cases", () => {
  it("handles maxAttempts=1 (no retries)", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => fakeResponse(500, {}),
    ]);
    const config = baseConfig(fetch, { maxAttempts: 1 });

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    expect(callCount()).toBe(1);
  });

  it("returns NETWORK error on fetch throwing a non-AbortError", async () => {
    const config = baseConfig(async () => { throw new Error("DNS resolution failed"); });

    // After exhausting retries...
    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NETWORK");
    expect(result.error.message).toContain("DNS resolution failed");
    expect(result.error.retriable).toBe(true);
  });

  it("handles mixed transient errors before success", async () => {
    const { fetch, callCount } = sequenceFetch([
      () => { throw new TypeError("connection reset"); },
      () => fakeResponse(502, {}),
      () => fakeResponse(200, { recovered: true }),
    ]);
    const config = baseConfig(fetch);

    const result = await httpRequest(config, BASE_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.json).toEqual({ recovered: true });
    expect(callCount()).toBe(3);
  });
});
