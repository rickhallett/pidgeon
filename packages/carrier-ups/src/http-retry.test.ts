import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 8 — HTTP hardening.
 *
 * Tests that getRates() retries transient failures with exponential backoff,
 * respects Retry-After on 429, enforces a per-request timeout, and does NOT
 * retry non-retriable errors (400, 401, 403).
 *
 * All tests use a stateful fake fetch that returns different responses on
 * successive calls. Assertions target call counts and final outcomes, not
 * internal retry implementation details.
 */

const MINIMAL_UPS_RESPONSE = {
  RateResponse: {
    RatedShipment: [
      {
        Service: { Code: "03" },
        BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
        TotalCharges: { CurrencyCode: "USD", MonetaryValue: "10.00" },
        RatedPackage: [],
        TimeInTransit: {
          ServiceSummary: {
            Service: { Description: "UPS Ground" },
            EstimatedArrival: { BusinessDaysInTransit: "2" },
            GuaranteedIndicator: "",
          },
        },
      },
    ],
  },
};

const TOKEN_RESPONSE = {
  access_token: "test-token",
  token_type: "Bearer",
  expires_in: 14399,
};

const DOMESTIC_REQUEST: RateRequest = {
  origin: { street: "123 Main St", postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
  destination: { street: "456 Oak Ave", postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
  packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
};

/**
 * Creates a stateful fake fetch where the rating endpoint returns different
 * responses on successive calls. Token endpoint always succeeds.
 */
function sequenceFetch(
  ratingResponses: Array<() => Response | Promise<Response>>,
): { fetch: FetchFn; ratingCallCount: () => number; ratingTimestamps: () => number[] } {
  let ratingCalls = 0;
  const timestamps: number[] = [];

  const fakeFetch: FetchFn = async (input, _init) => {
    const url = String(input);

    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify(TOKEN_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rating endpoint — return next response in sequence
    const idx = ratingCalls;
    ratingCalls++;
    timestamps.push(Date.now());

    if (idx < ratingResponses.length) {
      return ratingResponses[idx]!();
    }
    // Past the sequence — return success as fallback
    return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetch: fakeFetch,
    ratingCallCount: () => ratingCalls,
    ratingTimestamps: () => timestamps,
  };
}

function makeProvider(fakeFetch: FetchFn): UpsRateProvider {
  return new UpsRateProvider({
    fetch: fakeFetch,
    credentials: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      accountNumber: "test-account",
    },
  });
}

function serverError(status: number): () => Response {
  return () => new Response("Server Error", {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function clientError(status: number, body?: Record<string, unknown>): () => Response {
  return () => new Response(JSON.stringify(body ?? { response: { errors: [{ code: String(status), message: "Error" }] } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function networkError(): () => never {
  return () => { throw new TypeError("fetch failed"); };
}

function success(): () => Response {
  return () => new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rateLimited(retryAfter: string): () => Response {
  return () => new Response(JSON.stringify({ response: { errors: [{ code: "429", message: "Rate limit exceeded" }] } }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": retryAfter,
    },
  });
}

// --- Retry on transient failures ---

describe("http retry: transient server errors", () => {
  it("retries on 500 and succeeds on subsequent attempt", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      serverError(500),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(2);
  });

  it("retries on 502 and succeeds on subsequent attempt", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      serverError(502),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(2);
  });

  it("retries on 503 and succeeds on subsequent attempt", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      serverError(503),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(2);
  });

  it("retries on network error and succeeds on subsequent attempt", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      networkError(),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(2);
  });
});

// --- Max attempts ---

describe("http retry: max attempts", () => {
  it("gives up after max retry attempts and returns the last error with status", async () => {
    // All calls fail — should eventually stop retrying
    const { fetch, ratingCallCount } = sequenceFetch([
      serverError(500),
      serverError(500),
      serverError(500),
      serverError(500),
      serverError(500),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Should have tried more than once but not infinitely
    expect(ratingCallCount()).toBeGreaterThan(1);
    expect(ratingCallCount()).toBeLessThanOrEqual(4); // reasonable max: initial + 3 retries
    // Error message should contain the status code from the last failure
    expect(result.error.message).toContain("500");
  });

  it("recovers when the last attempt succeeds", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      serverError(500),
      serverError(502),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(3);
  });
});

// --- Exponential backoff ---

describe("http retry: backoff timing", () => {
  it("waits longer between successive retries", async () => {
    const { fetch, ratingTimestamps } = sequenceFetch([
      serverError(500),
      serverError(500),
      success(),
    ]);
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const timestamps = ratingTimestamps();
    expect(timestamps.length).toBe(3);

    const firstGap = timestamps[1]! - timestamps[0]!;
    const secondGap = timestamps[2]! - timestamps[1]!;

    // Second gap should be longer than first (exponential backoff)
    expect(secondGap).toBeGreaterThan(firstGap);
  });
});

// --- 429 with Retry-After ---

describe("http retry: 429 rate limiting", () => {
  it("retries after 429 and succeeds", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      rateLimited("1"),
      success(),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    expect(ratingCallCount()).toBe(2);
  });

  it("respects Retry-After header as minimum delay", async () => {
    const { fetch, ratingTimestamps } = sequenceFetch([
      rateLimited("1"), // wait at least 1 second
      success(),
    ]);
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const timestamps = ratingTimestamps();
    expect(timestamps.length).toBe(2);

    const gap = timestamps[1]! - timestamps[0]!;
    // Should have waited at least ~1 second (with tolerance for timing)
    expect(gap).toBeGreaterThanOrEqual(900);
  });
});

// --- Non-retriable errors ---

describe("http retry: non-retriable errors", () => {
  it("does not retry on 400 Bad Request", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      clientError(400),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    expect(ratingCallCount()).toBe(1);
  });

  it("does not retry on 401 Unauthorized", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      clientError(401, { response: { errors: [{ code: "250003", message: "Invalid Access Token" }] } }),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    expect(ratingCallCount()).toBe(1);
  });

  it("does not retry on 403 Forbidden", async () => {
    const { fetch, ratingCallCount } = sequenceFetch([
      clientError(403, { response: { errors: [{ code: "250002", message: "Blocked Merchant" }] } }),
    ]);
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    expect(ratingCallCount()).toBe(1);
  });
});

// --- Timeout ---

describe("http retry: timeout", () => {
  it("retries on timeout and eventually returns a timeout error", async () => {
    let ratingCalls = 0;

    const fakeFetch: FetchFn = async (input, init) => {
      const url = String(input);

      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify(TOKEN_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      ratingCalls++;

      // Respect AbortSignal — wait until aborted or a long time
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted", "AbortError"));
          return;
        }
        const hangTimer = setTimeout(() => {
          resolve(new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        }, 30_000);

        signal?.addEventListener("abort", () => {
          clearTimeout(hangTimer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    };
    const provider = makeProvider(fakeFetch);

    const start = Date.now();
    const result = await provider.getRates(DOMESTIC_REQUEST);
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("timeout");
    // All attempts should time out — timeout is a transient failure like
    // network errors and 5xx, so the retry loop should exhaust max attempts.
    expect(ratingCalls).toBe(4);
    // 4 attempts × 3s timeout + backoff delays — well under 30s
    expect(elapsed).toBeLessThan(20_000);
  }, 20_000);
});
