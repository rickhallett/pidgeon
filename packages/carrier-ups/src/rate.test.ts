import { describe, it, expect } from "bun:test";

/**
 * Walking skeleton — BUILD_ORDER Step 2.
 *
 * One test that forces the entire vertical slice into existence:
 *   domain RateRequest → UPS carrier provider → normalised RateQuote[]
 *
 * Stubs fetch at the boundary so no network call is made.
 * Uses a realistic UPS response payload from docs/ups-api-reference.md.
 */

// These imports don't exist yet. The test defines the shape the system must take.
import type { RateRequest, RateQuote } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

const UPS_RATE_RESPONSE = {
  RateResponse: {
    Response: {
      ResponseStatus: { Code: "1", Description: "Success" },
    },
    RatedShipment: [
      {
        Service: { Code: "03", Description: "" },
        BillingWeight: {
          UnitOfMeasurement: { Code: "LBS", Description: "Pounds" },
          Weight: "1.0",
        },
        TotalCharges: {
          CurrencyCode: "USD",
          MonetaryValue: "12.36",
        },
        RatedPackage: [
          {
            ItemizedCharges: [
              {
                Code: "375",
                CurrencyCode: "USD",
                MonetaryValue: "2.10",
                SubType: "Fuel Surcharge",
              },
            ],
          },
        ],
        TimeInTransit: {
          ServiceSummary: {
            Service: { Description: "UPS Ground" },
            EstimatedArrival: {
              Arrival: { Date: "20230104", Time: "233000" },
              BusinessDaysInTransit: "2",
            },
            GuaranteedIndicator: "",
          },
        },
      },
    ],
  },
} as const;

describe("walking skeleton", () => {
  it("returns a normalised rate quote for a domestic UPS Ground shipment", async () => {
    // Arrange — stub fetch to return realistic UPS response
    const fakeFetch: FetchFn = async (input, _init) => {
      if (String(input).includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "test-token", token_type: "Bearer", expires_in: 14399 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(UPS_RATE_RESPONSE), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };

    const provider = new UpsRateProvider({
      fetch: fakeFetch,
      credentials: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        accountNumber: "test-account",
      },
    });

    const request: RateRequest = {
      origin: {
        street: "123 Main St",
        postalCode: "21093",
        countryCode: "US",
        city: "Timonium",
        state: "MD",
      },
      destination: {
        street: "456 Oak Ave",
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

    // Act
    const result = await provider.getRates(request);

    // Assert — Result type: success path
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing

    const quotes: RateQuote[] = result.data;
    expect(quotes).toHaveLength(1);

    const quote = quotes[0]!;
    expect(quote.carrier).toBe("UPS");
    expect(quote.serviceCode).toBe("03");
    expect(quote.serviceName).toBe("UPS Ground");
    expect(quote.totalCharge).toBe(12.36);
    expect(quote.currency).toBe("USD");
    expect(quote.transitDays).toBe(2);
    expect(quote.billableWeight).toEqual({ value: 1.0, unit: "LBS" });
    expect(quote.surcharges).toEqual([
      { type: "Fuel Surcharge", amount: 2.10 },
    ]);
    expect(quote.guaranteed).toBe(false);
  });
});
