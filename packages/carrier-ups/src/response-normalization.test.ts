import { describe, it, expect } from "bun:test";
import type { RateQuote } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 5 — Response normalisation.
 *
 * Tests that realistic UPS multi-service responses map to correct RateQuote[].
 * The walking skeleton (rate.test.ts) covers the single-service happy path.
 * These tests widen coverage to multi-service, guaranteed vs non-guaranteed,
 * surcharge aggregation, and edge cases in the response shape.
 *
 * All tests stub both OAuth and rating endpoints. Assertions target the
 * normalised RateQuote output, not the raw UPS response shape.
 */

const DOMESTIC_REQUEST = {
  origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
  destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
  packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
} as const;

function makeRatedShipment(overrides: {
  serviceCode: string;
  serviceName: string;
  totalCharge: string;
  currency?: string;
  weight?: string;
  weightUnit?: string;
  transitDays: string;
  guaranteed: boolean;
  surcharges?: Array<{ code: string; amount: string; subType: string }>;
}) {
  return {
    Service: { Code: overrides.serviceCode },
    BillingWeight: {
      UnitOfMeasurement: { Code: overrides.weightUnit ?? "LBS" },
      Weight: overrides.weight ?? "1.0",
    },
    TotalCharges: {
      CurrencyCode: overrides.currency ?? "USD",
      MonetaryValue: overrides.totalCharge,
    },
    RatedPackage: (overrides.surcharges ?? []).length > 0
      ? [{
          ItemizedCharges: (overrides.surcharges ?? []).map((s) => ({
            Code: s.code,
            CurrencyCode: overrides.currency ?? "USD",
            MonetaryValue: s.amount,
            SubType: s.subType,
          })),
        }]
      : [],
    TimeInTransit: {
      ServiceSummary: {
        Service: { Description: overrides.serviceName },
        EstimatedArrival: { BusinessDaysInTransit: overrides.transitDays },
        GuaranteedIndicator: overrides.guaranteed ? "Y" : "",
      },
    },
  };
}

function stubFetchWithResponse(ratedShipments: unknown[]): FetchFn {
  return async (input, _init) => {
    if (String(input).includes("/oauth/token")) {
      return new Response(JSON.stringify({
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: 14399,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      RateResponse: { RatedShipment: ratedShipments },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
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

// --- Multi-service responses ---

describe("response normalisation: multi-service", () => {
  it("maps a Shop response with multiple services to one quote per service", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "12.36", transitDays: "5", guaranteed: false,
      }),
      makeRatedShipment({
        serviceCode: "02", serviceName: "UPS 2nd Day Air",
        totalCharge: "28.50", transitDays: "2", guaranteed: true,
      }),
      makeRatedShipment({
        serviceCode: "01", serviceName: "UPS Next Day Air",
        totalCharge: "54.12", transitDays: "1", guaranteed: true,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(3);

    const [ground, secondDay, nextDay] = result.data as [RateQuote, RateQuote, RateQuote];

    expect(ground.serviceCode).toBe("03");
    expect(ground.serviceName).toBe("UPS Ground");
    expect(ground.totalCharge).toBe(12.36);
    expect(ground.transitDays).toBe(5);

    expect(secondDay.serviceCode).toBe("02");
    expect(secondDay.serviceName).toBe("UPS 2nd Day Air");
    expect(secondDay.totalCharge).toBe(28.50);
    expect(secondDay.transitDays).toBe(2);

    expect(nextDay.serviceCode).toBe("01");
    expect(nextDay.serviceName).toBe("UPS Next Day Air");
    expect(nextDay.totalCharge).toBe(54.12);
    expect(nextDay.transitDays).toBe(1);
  });

  it("sets carrier to UPS on every quote regardless of service", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "10.00", transitDays: "5", guaranteed: false,
      }),
      makeRatedShipment({
        serviceCode: "12", serviceName: "UPS 3 Day Select",
        totalCharge: "20.00", transitDays: "3", guaranteed: false,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const quote of result.data) {
      expect(quote.carrier).toBe("UPS");
    }
  });
});

// --- Guaranteed indicator ---

describe("response normalisation: guaranteed indicator", () => {
  it("sets guaranteed to true when GuaranteedIndicator is non-empty", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "01", serviceName: "UPS Next Day Air",
        totalCharge: "54.12", transitDays: "1", guaranteed: true,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.guaranteed).toBe(true);
  });

  it("sets guaranteed to false when GuaranteedIndicator is empty string", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "12.36", transitDays: "5", guaranteed: false,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.guaranteed).toBe(false);
  });

  it("correctly distinguishes guaranteed and non-guaranteed in same response", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "12.36", transitDays: "5", guaranteed: false,
      }),
      makeRatedShipment({
        serviceCode: "01", serviceName: "UPS Next Day Air",
        totalCharge: "54.12", transitDays: "1", guaranteed: true,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.guaranteed).toBe(false);
    expect(result.data[1]!.guaranteed).toBe(true);
  });
});

// --- Surcharge aggregation ---

describe("response normalisation: surcharges", () => {
  it("collects multiple surcharges from a single package", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "18.00", transitDays: "5", guaranteed: false,
        surcharges: [
          { code: "375", amount: "2.10", subType: "Fuel Surcharge" },
          { code: "376", amount: "3.50", subType: "Residential Surcharge" },
        ],
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.surcharges).toEqual([
      { type: "Fuel Surcharge", amount: 2.10 },
      { type: "Residential Surcharge", amount: 3.50 },
    ]);
  });

  it("returns empty surcharges array when no itemized charges exist", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "10.00", transitDays: "5", guaranteed: false,
        // no surcharges
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.surcharges).toEqual([]);
  });

  it("aggregates surcharges across multiple packages in a shipment", async () => {
    // Build a raw shipment with multiple RatedPackage entries
    const rawShipment = {
      Service: { Code: "03" },
      BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "5.0" },
      TotalCharges: { CurrencyCode: "USD", MonetaryValue: "25.00" },
      RatedPackage: [
        {
          ItemizedCharges: [
            { Code: "375", CurrencyCode: "USD", MonetaryValue: "1.50", SubType: "Fuel Surcharge" },
          ],
        },
        {
          ItemizedCharges: [
            { Code: "375", CurrencyCode: "USD", MonetaryValue: "1.75", SubType: "Fuel Surcharge" },
            { Code: "376", CurrencyCode: "USD", MonetaryValue: "4.00", SubType: "Residential Surcharge" },
          ],
        },
      ],
      TimeInTransit: {
        ServiceSummary: {
          Service: { Description: "UPS Ground" },
          EstimatedArrival: { BusinessDaysInTransit: "5" },
          GuaranteedIndicator: "",
        },
      },
    };

    const provider = makeProvider(stubFetchWithResponse([rawShipment]));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.surcharges).toEqual([
      { type: "Fuel Surcharge", amount: 1.50 },
      { type: "Fuel Surcharge", amount: 1.75 },
      { type: "Residential Surcharge", amount: 4.00 },
    ]);
  });
});

// --- Billing weight ---

describe("response normalisation: billing weight", () => {
  it("maps billing weight value and unit from UPS response", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "10.00", transitDays: "5", guaranteed: false,
        weight: "7.5", weightUnit: "KGS",
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.billableWeight).toEqual({ value: 7.5, unit: "KGS" });
  });
});

// --- Currency ---

describe("response normalisation: currency", () => {
  it("passes through the currency code from UPS response", async () => {
    const shipments = [
      makeRatedShipment({
        serviceCode: "11", serviceName: "UPS Standard",
        totalCharge: "22.50", currency: "CAD",
        transitDays: "4", guaranteed: false,
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.currency).toBe("CAD");
  });
});

// --- GuaranteedIndicator edge cases ---

describe("response normalisation: guaranteed indicator absent", () => {
  it("treats absent GuaranteedIndicator as not guaranteed", async () => {
    // UPS may omit GuaranteedIndicator entirely for non-guaranteed services
    // (API ref: "GuaranteedDelivery may be absent for non-guaranteed services").
    // undefined !== "" is true in JS — so a naive check misclassifies this.
    const rawShipment = {
      Service: { Code: "03" },
      BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
      TotalCharges: { CurrencyCode: "USD", MonetaryValue: "12.36" },
      RatedPackage: [],
      TimeInTransit: {
        ServiceSummary: {
          Service: { Description: "UPS Ground" },
          EstimatedArrival: { BusinessDaysInTransit: "5" },
          // GuaranteedIndicator intentionally absent — not "", but undefined
        },
      },
    };

    const provider = makeProvider(stubFetchWithResponse([rawShipment]));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.guaranteed).toBe(false);
  });
});

// --- Zero-value surcharges ---

describe("response normalisation: zero-value surcharges", () => {
  it("includes surcharges with zero monetary value in the output", async () => {
    // UPS commonly includes zero-value charges as informational line items.
    // Documenting pass-through behavior — callers filter for display.
    const shipments = [
      makeRatedShipment({
        serviceCode: "03", serviceName: "UPS Ground",
        totalCharge: "12.36", transitDays: "5", guaranteed: false,
        surcharges: [
          { code: "375", amount: "0.00", subType: "Fuel Surcharge" },
          { code: "376", amount: "3.50", subType: "Residential Surcharge" },
        ],
      }),
    ];

    const provider = makeProvider(stubFetchWithResponse(shipments));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]!.surcharges).toEqual([
      { type: "Fuel Surcharge", amount: 0 },
      { type: "Residential Surcharge", amount: 3.50 },
    ]);
  });
});

// --- Empty rated shipments ---

describe("response normalisation: empty results", () => {
  it("returns empty quotes array when RatedShipment is an empty array", async () => {
    // A Shop request between unsupported locations may return no services.
    const provider = makeProvider(stubFetchWithResponse([]));
    const result = await provider.getRates(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual([]);
  });
});
