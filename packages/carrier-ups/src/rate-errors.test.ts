import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 6 — Error paths.
 *
 * Every test here asserts that getRates() returns Result { ok: false }
 * with a meaningful error — never throws. This is the boundary contract.
 *
 * Categories:
 *   1. Network failures (fetch itself rejects)
 *   2. HTTP error responses (UPS returns 4xx/5xx)
 *   3. Malformed responses (valid HTTP, garbage body)
 *   4. Validation failures (response missing required fields)
 */

// --- Shared helpers ---

const DOMESTIC_REQUEST: RateRequest = {
  origin: {
    postalCode: "21093",
    countryCode: "US",
    city: "Timonium",
    state: "MD",
  },
  destination: {
    postalCode: "30005",
    countryCode: "US",
    city: "Alpharetta",
    state: "GA",
  },
  packages: [
    {
      weight: { value: 1, unit: "lb" },
      dimensions: { length: 5, width: 5, height: 5, unit: "in" },
    },
  ],
};

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

// --- 1. Network failures ---

describe("error paths: network failures", () => {
  it("returns error when fetch rejects with a network error", async () => {
    const provider = makeProvider(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("network");
  });

  it("returns error when fetch rejects with DNS resolution failure", async () => {
    const provider = makeProvider(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND onlinetools.ups.com");
    });

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("network");
  });

  it("returns error when request times out", async () => {
    const provider = makeProvider(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("timeout");
  });
});

// --- 2. HTTP error responses ---

describe("error paths: HTTP error responses", () => {
  it("returns error with UPS error message on 400 Bad Request", async () => {
    const upsError = {
      response: {
        errors: [
          {
            code: "111210",
            message:
              "The requested service is unavailable between the selected locations.",
          },
        ],
      },
    };

    const provider = makeProvider(async () =>
      new Response(JSON.stringify(upsError), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("111210");
    expect(result.error).toContain("unavailable between the selected locations");
  });

  it("returns auth error on 401 Unauthorized", async () => {
    const provider = makeProvider(async () =>
      new Response(JSON.stringify({ response: { errors: [{ code: "250003", message: "Invalid Access Token" }] } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("auth");
  });

  it("returns error on 403 Forbidden", async () => {
    const provider = makeProvider(async () =>
      new Response(JSON.stringify({ response: { errors: [{ code: "250002", message: "Blocked Merchant" }] } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Blocked Merchant");
  });

  it("returns rate-limit error on 429 with retriable hint", async () => {
    const provider = makeProvider(async () =>
      new Response(JSON.stringify({ response: { errors: [{ code: "429", message: "Rate limit exceeded" }] } }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("rate limit");
  });

  it("returns error on 500 Internal Server Error", async () => {
    const provider = makeProvider(async () =>
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("500");
  });

  it("returns error on 503 Service Unavailable", async () => {
    const provider = makeProvider(async () =>
      new Response("Service Unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("503");
  });
});

// --- 3. Malformed responses ---

describe("error paths: malformed responses", () => {
  it("returns error when response body is not valid JSON", async () => {
    const provider = makeProvider(async () =>
      new Response("<html>Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("parse");
  });

  it("returns error when response is valid JSON but empty object", async () => {
    const provider = makeProvider(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("RateResponse");
  });

  it("returns error when RatedShipment is missing from response", async () => {
    const provider = makeProvider(async () =>
      new Response(
        JSON.stringify({
          RateResponse: {
            Response: { ResponseStatus: { Code: "1", Description: "Success" } },
            // RatedShipment intentionally absent
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("RatedShipment");
  });

  it("returns error when TotalCharges.MonetaryValue is not a parseable number", async () => {
    const provider = makeProvider(async () =>
      new Response(
        JSON.stringify({
          RateResponse: {
            RatedShipment: [
              {
                Service: { Code: "03" },
                BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
                TotalCharges: { CurrencyCode: "USD", MonetaryValue: "NOT_A_NUMBER" },
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("monetary");
  });

  it("returns error when shipment element is missing TimeInTransit", async () => {
    const provider = makeProvider(async () =>
      new Response(
        JSON.stringify({
          RateResponse: {
            RatedShipment: [
              {
                Service: { Code: "03" },
                BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
                TotalCharges: { CurrencyCode: "USD", MonetaryValue: "12.36" },
                RatedPackage: [],
                // TimeInTransit intentionally absent
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeDefined();
  });

  it("returns error on 400 with HTML body", async () => {
    const provider = makeProvider(async () =>
      new Response("<html>Bad Request</html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("400");
  });

  it("returns error when surcharge MonetaryValue is unparseable", async () => {
    const provider = makeProvider(async () =>
      new Response(
        JSON.stringify({
          RateResponse: {
            RatedShipment: [
              {
                Service: { Code: "03" },
                BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
                TotalCharges: { CurrencyCode: "USD", MonetaryValue: "12.36" },
                RatedPackage: [
                  {
                    ItemizedCharges: [
                      {
                        Code: "375",
                        CurrencyCode: "USD",
                        MonetaryValue: "N/A",
                        SubType: "Fuel Surcharge",
                      },
                    ],
                  },
                ],
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("surcharge");
  });
});
