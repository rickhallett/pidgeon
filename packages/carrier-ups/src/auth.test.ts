import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 7 — Auth lifecycle.
 *
 * Tests that UpsRateProvider acquires OAuth tokens via client_credentials,
 * caches them, refreshes on expiry, and attaches them to API requests.
 *
 * The fake fetch intercepts both token and rating endpoints. Tests observe:
 *   - how many times the token endpoint is called
 *   - whether the Authorization header is present on rating requests
 *   - whether expired tokens trigger re-acquisition
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
  access_token: "test-token-abc123",
  token_type: "Bearer",
  expires_in: 14399, // ~4 hours, typical UPS response
  issued_at: String(Date.now()),
};

const DOMESTIC_REQUEST: RateRequest = {
  origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
  destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
  packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
};

type CapturedCall = {
  url: string;
  init: RequestInit | undefined;
};

/**
 * Creates a fake fetch that handles both the OAuth token endpoint and the
 * rating endpoint. Returns helpers to inspect what was called.
 */
function authAwareFetch(options?: {
  tokenResponse?: Record<string, unknown>;
  tokenStatus?: number;
}): {
  fetch: FetchFn;
  calls: () => CapturedCall[];
  tokenCalls: () => CapturedCall[];
  ratingCalls: () => CapturedCall[];
} {
  const allCalls: CapturedCall[] = [];

  const fakeFetch: FetchFn = async (input, init) => {
    const url = String(input);
    allCalls.push({ url, init });

    if (url.includes("/oauth/token")) {
      const status = options?.tokenStatus ?? 200;
      const body = options?.tokenResponse ?? TOKEN_RESPONSE;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Rating endpoint
    return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetch: fakeFetch,
    calls: () => allCalls,
    tokenCalls: () => allCalls.filter((c) => c.url.includes("/oauth/token")),
    ratingCalls: () => allCalls.filter((c) => !c.url.includes("/oauth/token")),
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

// --- Token acquisition ---

describe("auth lifecycle: token acquisition", () => {
  it("acquires an OAuth token before the first rating request", async () => {
    const { fetch, tokenCalls, ratingCalls } = authAwareFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    expect(tokenCalls()).toHaveLength(1);
    expect(ratingCalls()).toHaveLength(1);
  });

  it("sends client credentials as Basic auth to the token endpoint", async () => {
    const { fetch, tokenCalls } = authAwareFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const tokenCall = tokenCalls()[0]!;
    const headers = tokenCall.init?.headers as Record<string, string>;
    const expected = btoa("test-client-id:test-client-secret");
    expect(headers["Authorization"]).toBe(`Basic ${expected}`);
  });

  it("requests grant_type=client_credentials in the token request body", async () => {
    const { fetch, tokenCalls } = authAwareFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const tokenCall = tokenCalls()[0]!;
    const body = tokenCall.init?.body;
    expect(typeof body).toBe("string");
    expect(String(body)).toContain("grant_type=client_credentials");
  });
});

// --- Token attached to requests ---

describe("auth lifecycle: token usage", () => {
  it("attaches Bearer token to the rating request Authorization header", async () => {
    const { fetch, ratingCalls } = authAwareFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const ratingCall = ratingCalls()[0]!;
    const headers = ratingCall.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token-abc123");
  });
});

// --- Token caching ---

describe("auth lifecycle: token caching", () => {
  it("reuses a cached token for subsequent requests", async () => {
    const { fetch, tokenCalls } = authAwareFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);
    await provider.getRates(DOMESTIC_REQUEST);
    await provider.getRates(DOMESTIC_REQUEST);

    expect(tokenCalls()).toHaveLength(1);
  });
});

// --- Token invalidation on 401 ---

describe("auth lifecycle: token invalidation", () => {
  it("clears cached token when rating endpoint returns 401, re-acquires on next call", async () => {
    let ratingCallCount = 0;
    let tokenCallCount = 0;

    const fakeFetch: FetchFn = async (input, _init) => {
      const url = String(input);

      if (url.includes("/oauth/token")) {
        tokenCallCount++;
        return new Response(JSON.stringify({
          access_token: `token-${tokenCallCount}`,
          token_type: "Bearer",
          expires_in: 14399,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Rating endpoint: first call succeeds, second returns 401
      ratingCallCount++;
      if (ratingCallCount === 2) {
        return new Response(JSON.stringify({
          response: { errors: [{ code: "250003", message: "Invalid Access Token" }] },
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = makeProvider(fakeFetch);

    // First call: acquires token-1, rating succeeds
    const result1 = await provider.getRates(DOMESTIC_REQUEST);
    expect(result1.ok).toBe(true);
    expect(tokenCallCount).toBe(1);

    // Second call: reuses token-1, rating returns 401
    const result2 = await provider.getRates(DOMESTIC_REQUEST);
    expect(result2.ok).toBe(false);

    // Third call: must acquire token-2 (not reuse the revoked token-1)
    const result3 = await provider.getRates(DOMESTIC_REQUEST);
    expect(result3.ok).toBe(true);
    expect(tokenCallCount).toBe(2);
  });
});

// --- Token refresh ---

describe("auth lifecycle: token refresh", () => {
  it("uses the new token on rating requests after refresh", async () => {
    let tokenCallCount = 0;
    const ratingHeaders: string[] = [];

    const fakeFetch: FetchFn = async (input, init) => {
      const url = String(input);

      if (url.includes("/oauth/token")) {
        tokenCallCount++;
        return new Response(JSON.stringify({
          access_token: `token-v${tokenCallCount}`,
          token_type: "Bearer",
          expires_in: 1, // expires in 1 second
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Capture the Authorization header on rating calls
      const headers = init?.headers as Record<string, string> | undefined;
      ratingHeaders.push(headers?.["Authorization"] ?? "");

      return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = makeProvider(fakeFetch);

    // First call acquires token-v1
    await provider.getRates(DOMESTIC_REQUEST);
    expect(tokenCallCount).toBe(1);
    expect(ratingHeaders[0]).toBe("Bearer token-v1");

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Second call acquires token-v2, must use it
    await provider.getRates(DOMESTIC_REQUEST);
    expect(tokenCallCount).toBe(2);
    expect(ratingHeaders[1]).toBe("Bearer token-v2");
  });
});

// --- Auth error paths ---

describe("auth lifecycle: error paths", () => {
  it("returns error when token endpoint returns 401", async () => {
    const { fetch } = authAwareFetch({
      tokenStatus: 401,
      tokenResponse: { error: "invalid_client", error_description: "Invalid client credentials" },
    });
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("auth");
  });

  it("returns error when token endpoint returns 200 with non-JSON body", async () => {
    // Must be HTTP 200 so the !response.ok check doesn't catch it first —
    // this test exercises the JSON parse failure path specifically.
    const fakeFetch: FetchFn = async (input, _init) => {
      if (String(input).includes("/oauth/token")) {
        return new Response("<html>OK but not JSON</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = makeProvider(fakeFetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("parse token response");
  });

  it("returns error when token endpoint is unreachable", async () => {
    const fakeFetch: FetchFn = async (input, _init) => {
      if (String(input).includes("/oauth/token")) {
        throw new TypeError("fetch failed");
      }
      return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = makeProvider(fakeFetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("token");
  });

  it("returns error when token response is missing access_token field", async () => {
    const { fetch } = authAwareFetch({
      tokenResponse: { token_type: "Bearer", expires_in: 14399 },
    });
    const provider = makeProvider(fetch);

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("token");
  });
});
