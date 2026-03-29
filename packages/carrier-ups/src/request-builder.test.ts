import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 4 — Request building.
 *
 * Tests that domain RateRequest produces the correct UPS API payload *shape*.
 * We capture the fetch body and assert structural properties — not exact
 * wire-format strings that belong to the upstream API contract.
 *
 * Practical rule applied throughout:
 *   - if the assertion catches a bug in THIS library → keep it
 *   - if it only catches an upstream API version change → loosen or remove it
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

type CapturedRequest = {
  url: string | URL | Request;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
};

function capturingFetch(): { fetch: FetchFn; captured: () => CapturedRequest } {
  let captured: CapturedRequest | null = null;

  const fakeFetch: FetchFn = async (input, init) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(bodyStr); } catch { /* empty or non-JSON body */ }
    captured = { url: input, init, body };
    return new Response(JSON.stringify(MINIMAL_UPS_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetch: fakeFetch,
    captured: () => {
      if (!captured) throw new Error("fetch was never called");
      return captured;
    },
  };
}

function makeProvider(fakeFetch: FetchFn, accountNumber = "X12345"): UpsRateProvider {
  return new UpsRateProvider({
    fetch: fakeFetch,
    credentials: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      accountNumber,
    },
  });
}

const DOMESTIC_REQUEST: RateRequest = {
  origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
  destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
  packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
};

// --- Structural: required sections exist ---

describe("request builder: required sections", () => {
  it("includes Shipper, ShipTo, ShipFrom, PaymentDetails, and Package", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const shipment = (captured().body as any)?.RateRequest?.Shipment;
    expect(shipment).toBeDefined();
    expect(shipment).toHaveProperty("Shipper");
    expect(shipment).toHaveProperty("ShipTo");
    expect(shipment).toHaveProperty("ShipFrom");
    expect(shipment).toHaveProperty("PaymentDetails");
    expect(shipment).toHaveProperty("Package");
  });

  it("includes DeliveryTimeInformation for transit-aware rating", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const shipment = (captured().body as any)?.RateRequest?.Shipment;
    expect(shipment).toHaveProperty("DeliveryTimeInformation");
  });
});

// --- Domain values land in the right place ---

describe("request builder: address mapping", () => {
  it("maps origin to ShipFrom address fields", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const address = (captured().body as any)?.RateRequest?.Shipment?.ShipFrom?.Address;
    expect(address?.City).toBe("Timonium");
    expect(address?.StateProvinceCode).toBe("MD");
    expect(address?.PostalCode).toBe("21093");
    expect(address?.CountryCode).toBe("US");
  });

  it("maps destination to ShipTo address fields", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    const address = (captured().body as any)?.RateRequest?.Shipment?.ShipTo?.Address;
    expect(address?.City).toBe("Alpharetta");
    expect(address?.StateProvinceCode).toBe("GA");
    expect(address?.PostalCode).toBe("30005");
    expect(address?.CountryCode).toBe("US");
  });

  it("sets Shipper address from origin and account number from config", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch, "ABC999");

    await provider.getRates(DOMESTIC_REQUEST);

    const shipper = (captured().body as any)?.RateRequest?.Shipment?.Shipper;
    expect(shipper?.ShipperNumber).toBe("ABC999");
    expect(shipper?.Address?.PostalCode).toBe("21093");
    expect(shipper?.Address?.CountryCode).toBe("US");
  });
});

describe("request builder: package mapping", () => {
  it("maps weight and dimensions from domain values", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      ...DOMESTIC_REQUEST,
      packages: [{ weight: { value: 3.5, unit: "lb" }, dimensions: { length: 10, width: 8, height: 6, unit: "in" } }],
    });

    const shipment = (captured().body as any)?.RateRequest?.Shipment;
    const pkg = Array.isArray(shipment?.Package) ? shipment.Package[0] : shipment?.Package;
    expect(pkg?.PackageWeight?.Weight).toBe("3.5");
    expect(pkg?.Dimensions?.Length).toBe("10");
    expect(pkg?.Dimensions?.Width).toBe("8");
    expect(pkg?.Dimensions?.Height).toBe("6");
  });

  it("maps multiple packages as an array", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      ...DOMESTIC_REQUEST,
      packages: [
        { weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } },
        { weight: { value: 2, unit: "lb" }, dimensions: { length: 10, width: 10, height: 10, unit: "in" } },
      ],
    });

    const shipment = (captured().body as any)?.RateRequest?.Shipment;
    const packages = Array.isArray(shipment?.Package) ? shipment.Package : [shipment?.Package];
    expect(packages).toHaveLength(2);
    expect(packages[0]?.PackageWeight?.Weight).toBe("1");
    expect(packages[1]?.PackageWeight?.Weight).toBe("2");
  });
});

// --- Payment intent ---

describe("request builder: payment", () => {
  it("bills the shipper account number", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch, "SHIP789");

    await provider.getRates(DOMESTIC_REQUEST);

    const payment = (captured().body as any)?.RateRequest?.Shipment?.PaymentDetails;
    expect(payment?.ShipmentCharge?.BillShipper?.AccountNumber).toBe("SHIP789");
  });
});

// --- Transport essentials (library-owned) ---

describe("request builder: transport", () => {
  it("sends a POST with Content-Type application/json", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates(DOMESTIC_REQUEST);

    expect(captured().init?.method).toBe("POST");
    const headers = captured().init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
