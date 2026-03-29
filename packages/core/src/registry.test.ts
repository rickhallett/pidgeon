import { describe, it, expect } from "bun:test";
import type { CarrierProvider, CarrierResult, RateRequest, RateQuote } from "./index.js";

/**
 * BUILD_ORDER Step 11 — Multi-carrier extensibility.
 *
 * Tests for the carrier registry/factory that maps carrier names to provider
 * instances. The registry is the extension point: adding a new carrier means
 * registering a new provider, no changes to existing code.
 *
 * Dependencies that must exist for this file to compile:
 *   - CarrierRegistry class from "./registry.js"
 *   - CarrierProvider type from "./index.js" (already exists)
 */

// --- Fake providers ---

const DOMESTIC_REQUEST: RateRequest = {
  origin: { street: "123 Main St", postalCode: "21093", countryCode: "US", city: "Timonium", state: "MD" },
  destination: { street: "456 Oak Ave", postalCode: "30005", countryCode: "US", city: "Alpharetta", state: "GA" },
  packages: [{ weight: { value: 1, unit: "lb" }, dimensions: { length: 5, width: 5, height: 5, unit: "in" } }],
};

function fakeProvider(carrier: string, charge: number): CarrierProvider {
  return {
    async getRates(): Promise<CarrierResult<RateQuote[]>> {
      return {
        ok: true,
        data: [
          {
            carrier,
            serviceCode: "GND",
            serviceName: `${carrier} Ground`,
            totalCharge: charge,
            currency: "USD",
            transitDays: 3,
            estimatedDelivery: null,
            billableWeight: { value: 1, unit: "LBS" },
            surcharges: [],
            guaranteed: false,
          },
        ],
      };
    },
  };
}

function failingProvider(carrier: string, error: string): CarrierProvider {
  return {
    async getRates(): Promise<CarrierResult<RateQuote[]>> {
      return { ok: false, error: { code: "UNKNOWN", message: error, carrier, retriable: false } };
    },
  };
}

// --- Register and retrieve ---

describe("registry: register and resolve", () => {
  it("returns a registered provider by name", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    const upsProvider = fakeProvider("UPS", 12.5);
    registry.register("ups", upsProvider);

    const resolved = registry.resolve("ups");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data).toBe(upsProvider);
  });

  it("returns an error for an unknown carrier name", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    const resolved = registry.resolve("fedex");

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toContain("fedex");
  });
});

// --- Case insensitivity ---

describe("registry: case insensitivity", () => {
  it("resolves regardless of case used at registration vs lookup", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    const provider = fakeProvider("UPS", 10);
    registry.register("UPS", provider);

    const lower = registry.resolve("ups");
    const upper = registry.resolve("UPS");
    const mixed = registry.resolve("Ups");

    expect(lower.ok).toBe(true);
    expect(upper.ok).toBe(true);
    expect(mixed.ok).toBe(true);
    if (lower.ok) expect(lower.data).toBe(provider);
  });
});

// --- Duplicate registration ---

describe("registry: duplicate prevention", () => {
  it("rejects duplicate registration of the same carrier name", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", fakeProvider("UPS", 10));

    expect(() => registry.register("ups", fakeProvider("UPS", 20))).toThrow();
  });

  it("treats case-different names as the same carrier for duplicate check", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", fakeProvider("UPS", 10));

    expect(() => registry.register("UPS", fakeProvider("UPS", 20))).toThrow();
  });
});

// --- List carriers ---

describe("registry: list carriers", () => {
  it("returns an empty list when no carriers are registered", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    expect(registry.carriers()).toEqual([]);
  });

  it("lists all registered carrier names", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", fakeProvider("UPS", 10));
    registry.register("fedex", fakeProvider("FedEx", 11));

    const names = registry.carriers();
    expect(names).toHaveLength(2);
    expect(names).toContain("ups");
    expect(names).toContain("fedex");
  });
});

// --- Multi-carrier rate aggregation ---

describe("registry: multi-carrier getRates", () => {
  it("aggregates quotes from all registered carriers", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", fakeProvider("UPS", 12.5));
    registry.register("fedex", fakeProvider("FedEx", 11.0));

    const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);

    const carriers = result.data.map((q) => q.carrier);
    expect(carriers).toContain("UPS");
    expect(carriers).toContain("FedEx");
  });

  it("returns quotes from healthy carriers when one carrier fails", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", fakeProvider("UPS", 12.5));
    registry.register("fedex", failingProvider("FedEx", "FedEx auth error"));

    const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);

    // Partial success — we still get UPS quotes
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.carrier).toBe("UPS");
  });

  it("returns an error when all carriers fail", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    registry.register("ups", failingProvider("UPS", "UPS down"));
    registry.register("fedex", failingProvider("FedEx", "FedEx down"));

    const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("UPS");
    expect(result.error).toContain("FedEx");
  });

  it("returns an error when no carriers are registered", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toMatch(/no.*carrier/);
  });

  it("queries carriers concurrently, not sequentially", async () => {
    const { CarrierRegistry } = await import("./registry.js");
    const registry = new CarrierRegistry();

    // Each provider takes 100ms
    const slowProvider = (carrier: string): CarrierProvider => ({
      async getRates(): Promise<CarrierResult<RateQuote[]>> {
        await new Promise((r) => setTimeout(r, 100));
        return { ok: true, data: [{ carrier, serviceCode: "GND", serviceName: `${carrier} Ground`, totalCharge: 10, currency: "USD", transitDays: 3, estimatedDelivery: null, billableWeight: { value: 1, unit: "LBS" }, surcharges: [], guaranteed: false }] };
      },
    });

    registry.register("ups", slowProvider("UPS"));
    registry.register("fedex", slowProvider("FedEx"));
    registry.register("dhl", slowProvider("DHL"));

    const start = Date.now();
    const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(3);

    // 3 × 100ms sequential = 300ms. Concurrent should be ~100ms.
    // Allow generous margin but must be well under sequential time.
    expect(elapsed).toBeLessThan(250);
  });
});
