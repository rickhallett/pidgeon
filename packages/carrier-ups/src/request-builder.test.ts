import { describe, it, expect } from "bun:test";
import type { RateRequest } from "@pidgeon/core";
import { UpsRateProvider, type FetchFn } from "./rate.js";

/**
 * BUILD_ORDER Step 4 — Real request building.
 *
 * Tests that domain RateRequest produces the correct UPS API payload shape.
 * We capture the fetch body and assert its structure against the UPS Rating
 * API reference (docs/ups-api-reference.md).
 *
 * The fake fetch returns a minimal valid response so getRates() completes,
 * but the assertions target the *request*, not the response.
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
  body: unknown;
};

function capturingFetch(): { fetch: FetchFn; captured: () => CapturedRequest } {
  let captured: CapturedRequest | null = null;

  const fakeFetch: FetchFn = async (input, init) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    captured = { url: input, init, body: JSON.parse(bodyStr) };
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

// --- Request shape ---

describe("request builder: address mapping", () => {
  it("maps origin address to UPS ShipFrom format", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const shipFrom = captured().body as any;
    const address = shipFrom.RateRequest.Shipment.ShipFrom.Address;
    expect(address.City).toBe("Timonium");
    expect(address.StateProvinceCode).toBe("MD");
    expect(address.PostalCode).toBe("21093");
    expect(address.CountryCode).toBe("US");
  });

  it("maps destination address to UPS ShipTo format", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const shipTo = captured().body as any;
    const address = shipTo.RateRequest.Shipment.ShipTo.Address;
    expect(address.City).toBe("Alpharetta");
    expect(address.StateProvinceCode).toBe("GA");
    expect(address.PostalCode).toBe("30005");
    expect(address.CountryCode).toBe("US");
  });

  it("sets Shipper address and ShipperNumber from config", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch, "ABC999");

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const shipper = (captured().body as any).RateRequest.Shipment.Shipper;
    expect(shipper.ShipperNumber).toBe("ABC999");
    expect(shipper.Address.PostalCode).toBe("21093");
    expect(shipper.Address.CountryCode).toBe("US");
  });
});

describe("request builder: package mapping", () => {
  it("maps a single package with weight and dimensions", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 3.5, unit: "lb" }, dimensions: { length: 10, width: 8, height: 6, unit: "in" } }],
    });

    const shipment = (captured().body as any).RateRequest.Shipment;
    const pkg = Array.isArray(shipment.Package) ? shipment.Package[0] : shipment.Package;
    expect(pkg.PackageWeight.Weight).toBe("3.5");
    expect(pkg.PackageWeight.UnitOfMeasurement.Code).toBe("LBS");
    expect(pkg.Dimensions.Length).toBe("10");
    expect(pkg.Dimensions.Width).toBe("8");
    expect(pkg.Dimensions.Height).toBe("6");
    expect(pkg.Dimensions.UnitOfMeasurement.Code).toBe("IN");
  });

  it("maps multiple packages as an array", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [
        { weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } },
        { weight: { value: 2, unit: "lb" }, dimensions: { length: 10, width: 10, height: 10, unit: "in" } },
      ],
    });

    const shipment = (captured().body as any).RateRequest.Shipment;
    const packages = Array.isArray(shipment.Package) ? shipment.Package : [shipment.Package];
    expect(packages).toHaveLength(2);
    expect(packages[0].PackageWeight.Weight).toBe("1");
    expect(packages[1].PackageWeight.Weight).toBe("2");
  });

  it("sets PackagingType to 02 (Customer Supplied Package)", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const shipment = (captured().body as any).RateRequest.Shipment;
    const pkg = Array.isArray(shipment.Package) ? shipment.Package[0] : shipment.Package;
    expect(pkg.PackagingType.Code).toBe("02");
  });
});

describe("request builder: request options", () => {
  it("uses Shop request option to get all available services", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const req = (captured().body as any).RateRequest.Request;
    expect(req.RequestOption).toBe("Shoptimeintransit");
  });

  it("sets PaymentDetails with shipper account number", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch, "SHIP789");

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    const payment = (captured().body as any).RateRequest.Shipment.PaymentDetails;
    expect(payment.ShipmentCharge.Type).toBe("01");
    expect(payment.ShipmentCharge.BillShipper.AccountNumber).toBe("SHIP789");
  });

  it("sends request to the correct UPS endpoint URL", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    expect(String(captured().url)).toBe("https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit");
  });

  it("sends POST with Content-Type application/json", async () => {
    const { fetch, captured } = capturingFetch();
    const provider = makeProvider(fetch);

    await provider.getRates({
      origin: { postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
      destination: { postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
      packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
    });

    expect(captured().init?.method).toBe("POST");
    const headers = captured().init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
