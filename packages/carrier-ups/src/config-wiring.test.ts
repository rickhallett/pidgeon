import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 9 — Config wiring.
 *
 * Verifies that UpsRateProvider reads retry policy, endpoint URLs, and token
 * expiry buffer from its config rather than using hardcoded values.
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

function ok(): Response {
  return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenOk(): Response {
  return new Response(JSON.stringify(TOKEN_RESPONSE), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// --- URL configuration ---

describe("config wiring: endpoint URLs", () => {
  it("uses configured rating URL instead of hardcoded default", async () => {
    const calledUrls: string[] = [];
    const fakeFetch: FetchFn = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes("/oauth/token")) return tokenOk();
      return ok();
    };

    const provider = new UpsRateProvider({
      fetch: fakeFetch,
      credentials: { clientId: "id", clientSecret: "secret", accountNumber: "acct" },
      urls: {
        rating: "https://wwwcie.ups.com/api/rating/v2409/Shoptimeintransit",
        token: "https://onlinetools.ups.com/security/v1/oauth/token",
      },
    });

    await provider.getRates(DOMESTIC_REQUEST);

    const ratingUrl = calledUrls.find((u) => u.includes("/rating/"));
    expect(ratingUrl).toContain("wwwcie.ups.com");
  });

  it("uses configured token URL instead of hardcoded default", async () => {
    const calledUrls: string[] = [];
    const fakeFetch: FetchFn = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes("/oauth/token")) return tokenOk();
      return ok();
    };

    const provider = new UpsRateProvider({
      fetch: fakeFetch,
      credentials: { clientId: "id", clientSecret: "secret", accountNumber: "acct" },
      urls: {
        rating: "https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit",
        token: "https://wwwcie.ups.com/security/v1/oauth/token",
      },
    });

    await provider.getRates(DOMESTIC_REQUEST);

    const tokenUrl = calledUrls.find((u) => u.includes("/oauth/"));
    expect(tokenUrl).toContain("wwwcie.ups.com");
  });
});

// --- Retry policy configuration ---

describe("config wiring: retry policy", () => {
  it("respects configured maxAttempts", async () => {
    let ratingCalls = 0;
    const fakeFetch: FetchFn = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) return tokenOk();
      ratingCalls++;
      return new Response("Server Error", { status: 500, headers: { "Content-Type": "text/plain" } });
    };

    const provider = new UpsRateProvider({
      fetch: fakeFetch,
      credentials: { clientId: "id", clientSecret: "secret", accountNumber: "acct" },
      retry: { maxAttempts: 2, baseDelayMs: 10, timeoutMs: 3_000, maxRetryAfterSeconds: 5 },
    });

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    expect(ratingCalls).toBe(2);
  });
});

// --- Token expiry buffer ---

describe("config wiring: token expiry buffer", () => {
  it("applies configured expiry buffer instead of hardcoded 60 seconds", async () => {
    let tokenCalls = 0;
    const fakeFetch: FetchFn = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        tokenCalls++;
        // Token expires in 200 seconds from now
        return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, token_type: "Bearer", expires_in: 200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return ok();
    };

    // Buffer of 300 seconds — larger than expires_in of 200, so token should
    // be considered expired immediately and re-acquired on every call
    const provider = new UpsRateProvider({
      fetch: fakeFetch,
      credentials: { clientId: "id", clientSecret: "secret", accountNumber: "acct" },
      tokenExpiryBufferSeconds: 300,
    });

    await provider.getRates(DOMESTIC_REQUEST);
    await provider.getRates(DOMESTIC_REQUEST);

    // With buffer > expires_in, token is always "expired" → 2 acquisitions
    expect(tokenCalls).toBe(2);
  });
});
