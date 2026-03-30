# Architecture Maintainability Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 6 findings from the Codex architecture-maintainability review to make the codebase extensible for additional carriers and carrier operations.

**Architecture:** Pure refactoring — no new features. Extract, split, tighten. All 151 existing tests must stay green throughout. New tests are written only for behavior changes (not for extract-and-move refactors where existing tests already cover the behavior).

**Tech Stack:** TypeScript (strict), Bun, Zod, bun:test

**Source review:** `docs/reviews/architecture-maintainability-20260330-061936-codex.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `packages/carrier-ups/src/types.ts` | UPS-specific types: credentials, config, response shapes |
| `packages/carrier-ups/src/auth.ts` | OAuth token management: acquire, cache, refresh |
| `packages/carrier-ups/src/request-builder.ts` | Domain → UPS API payload construction |
| `packages/carrier-ups/src/response-parser.ts` | UPS API response → RateQuote[] normalization |

### Files to modify

| File | Changes |
|------|---------|
| `packages/core/src/http.ts` | Fix BUG I (neutral logging), fix BUG C (parseErrorBody message) |
| `packages/core/src/http.test.ts` | Update tests for fixed bugs |
| `packages/core/src/schemas.ts` | Add `WeightUnit`, `DimensionUnit` constrained unions |
| `packages/core/src/index.ts` | Split CarrierProvider, structured AggregatedRateResult error, new exports |
| `packages/core/src/registry.ts` | Structured aggregate error, capability metadata |
| `packages/core/src/registry.test.ts` | Tests for structured aggregate error |
| `packages/carrier-ups/src/rate.ts` | Thin orchestrator importing from new modules |

---

## Task 1: Generalize HTTP Transport Layer

**Review finding:** [MEDIUM] HTTP layer behaves like a rating-specific JSON helper. Hardcoded "rating request" log label (BUG I). `parseErrorBody` never sets message (BUG C).

**Files:**
- Modify: `packages/core/src/http.ts`
- Modify: `packages/core/src/http.test.ts`

### Subtask 1a: Fix BUG I — neutral log labels

- [ ] **Step 1: Update test to assert neutral log label**

In `packages/core/src/http.test.ts`, find the test suite for BUG I (around line 497). The test currently documents that the generic module logs "rating request". Update it to assert a neutral label instead.

Find the test near line 497 that captures log messages and asserts on them. Change the expected log message from `"rating request"` to `"http request"`. The test should look like:

```typescript
it("uses neutral log labels, not carrier-specific ones", async () => {
  const logs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const logger = {
    debug: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    info: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    warn: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
    error: (msg: string, meta?: Record<string, unknown>) => logs.push({ msg, meta }),
  };

  const config: HttpClientConfig = {
    fetch: staticFetch(fakeResponse(200, { ok: true })),
    logger,
  };

  await httpRequest(config, {
    url: "https://example.com/api",
    method: "POST",
    headers: {},
    carrier: "TestCarrier",
  });

  const infoLogs = logs.filter((l) => l.msg === "http request");
  expect(infoLogs.length).toBeGreaterThanOrEqual(1);
  // Must NOT contain carrier-specific terms like "rating"
  const allMessages = logs.map((l) => l.msg);
  expect(allMessages.every((m) => !m.includes("rating"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/http.test.ts`
Expected: FAIL — the current code logs `"rating request"`, not `"http request"`

**Important:** If the test already uses `"http request"` (BUG I was already fixed), skip to Step 4. Read the actual test assertion before proceeding.

- [ ] **Step 3: Fix the log label in http.ts**

In `packages/core/src/http.ts`, line 103, change:

```typescript
// Before:
logger?.info("rating request", { url: request.url, attempt });

// After:
logger?.info("http request", { url: request.url, attempt });
```

Similarly, update any other log statements that contain carrier-specific wording. The debug log on line 104 (`"request payload"`) is already neutral — keep it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/http.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite to check for regressions**

Run: `bun test`
Expected: 151 pass, 0 fail

**Note:** If UPS tests reference the old log label in their assertions, those tests will break. Check `packages/carrier-ups/src/*.test.ts` for any assertions on log messages containing "rating request" and update them too.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http.ts packages/core/src/http.test.ts
git commit -m "fix(http): use neutral log labels in generic HTTP module (BUG I)"
```

### Subtask 1b: Fix BUG C — parseErrorBody loses error message

- [ ] **Step 7: Read the existing BUG C test**

Read `packages/core/src/http.test.ts` around lines 409-459. Understand what the test asserts. The test likely documents that `message` is null (current buggy behavior). The fix: `parseErrorBody` should extract a human-readable message from the parsed JSON body.

- [ ] **Step 8: Update test to assert correct behavior**

The `parseErrorBody` function currently returns `{ raw, message: null }` always. The fix: when the body parses as JSON, attempt to extract a message string from common error response shapes (`body.message`, `body.error`, `body.error.message`).

Update or add a test:

```typescript
it("extracts message from error response body", async () => {
  const errorBody = { error: { message: "Invalid request" } };
  const config: HttpClientConfig = {
    fetch: staticFetch(fakeResponse(400, errorBody)),
  };

  const result = await httpRequest(config, {
    url: "https://example.com/api",
    method: "POST",
    headers: {},
    carrier: "Test",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    // The error message should include details from the body
    expect(result.error.message).toContain("Invalid request");
  }
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `bun test packages/core/src/http.test.ts`
Expected: FAIL — parseErrorBody never extracts the message

- [ ] **Step 10: Fix parseErrorBody in http.ts**

In `packages/core/src/http.ts`, replace the `parseErrorBody` function (lines 65-79):

```typescript
async function parseErrorBody(
  response: Response,
  logger: Logger | undefined,
): Promise<{ raw: unknown; message: string | null }> {
  let raw: unknown = "unparseable";
  let message: string | null = null;
  try {
    const body = await response.json();
    raw = body;
    // Extract message from common error response shapes
    if (typeof body === "object" && body !== null) {
      const b = body as Record<string, unknown>;
      if (typeof b.message === "string") {
        message = b.message;
      } else if (typeof b.error === "string") {
        message = b.error;
      } else if (typeof b.error === "object" && b.error !== null) {
        const err = b.error as Record<string, unknown>;
        if (typeof err.message === "string") {
          message = err.message;
        }
      }
    }
  } catch {
    // Body is not parseable JSON
  }
  logger?.debug("error response", { status: response.status, body: raw });
  return { raw, message };
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `bun test packages/core/src/http.test.ts`
Expected: PASS

- [ ] **Step 12: Run full suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/http.ts packages/core/src/http.test.ts
git commit -m "fix(http): extract message from error response bodies (BUG C)"
```

---

## Task 2: Decompose UPS Rate Provider

**Review finding:** [HIGH] `UpsRateProvider` is doing orchestration, auth, transport wiring, request building, and response parsing in one file (391 lines).

**Files:**
- Create: `packages/carrier-ups/src/types.ts`
- Create: `packages/carrier-ups/src/auth.ts`
- Create: `packages/carrier-ups/src/request-builder.ts`
- Create: `packages/carrier-ups/src/response-parser.ts`
- Modify: `packages/carrier-ups/src/rate.ts`

**Strategy:** Extract-and-move refactor. Existing tests (151) cover all behavior through the `UpsRateProvider` class. No new tests needed — the 8 existing carrier-ups test files already test auth, request building, response parsing, and error handling independently. The public API (`UpsRateProvider` constructor + `getRates()`) does not change.

### Subtask 2a: Extract UPS types

- [ ] **Step 1: Create types.ts with types extracted from rate.ts**

Create `packages/carrier-ups/src/types.ts`:

```typescript
import type { CarrierError, FetchFn, Logger } from "@pidgeon/core";

// --- UPS credentials ---

export type UpsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly accountNumber: string;
};

// --- Retry and URL configuration ---

export type RetryConfig = {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly timeoutMs: number;
  readonly maxRetryAfterSeconds: number;
};

export type UrlConfig = {
  readonly rating: string;
  readonly token: string;
};

export type UpsRateProviderConfig = {
  readonly fetch: FetchFn;
  readonly credentials: UpsCredentials;
  readonly retry?: RetryConfig;
  readonly urls?: UrlConfig;
  readonly tokenExpiryBufferSeconds?: number;
  readonly logger?: Logger;
};

// --- UPS error helper ---

export function upsError(code: CarrierError["code"], message: string, retriable = false): CarrierError {
  return { code, message, carrier: "UPS", retriable };
}

// --- UPS API response types (shaped by UPS API documentation) ---

export type UpsRatedShipment = {
  Service: { Code: string };
  BillingWeight: {
    UnitOfMeasurement: { Code: string };
    Weight: string;
  };
  TotalCharges: {
    CurrencyCode: string;
    MonetaryValue: string;
  };
  RatedPackage: UpsRatedPackage[];
  TimeInTransit: {
    ServiceSummary: {
      Service: { Description: string };
      EstimatedArrival: {
        Arrival?: {
          Date?: string;
          Time?: string;
        };
        BusinessDaysInTransit: string;
      };
      GuaranteedIndicator?: string;
    };
  };
};

export type UpsRatedPackage = {
  ItemizedCharges?: UpsItemizedCharge[];
};

export type UpsItemizedCharge = {
  Code: string;
  CurrencyCode: string;
  MonetaryValue: string;
  SubType: string;
};

export type UpsErrorEnvelope = {
  response?: {
    errors?: Array<{ code: string; message: string }>;
  };
};
```

- [ ] **Step 2: Update rate.ts to import from types.ts**

In `packages/carrier-ups/src/rate.ts`, replace the local type definitions (lines 6-44 and 347-391) with imports:

```typescript
import type { UpsCredentials, RetryConfig, UrlConfig, UpsRateProviderConfig, UpsRatedShipment, UpsErrorEnvelope } from "./types.js";
import { upsError } from "./types.js";
```

Remove: the `UpsCredentials`, `RetryConfig`, `UrlConfig`, `UpsRateProviderConfig` type declarations, the `upsError` function, and all UPS response types (`UpsRatedShipment`, `UpsRatedPackage`, `UpsItemizedCharge`, `UpsErrorEnvelope`) from rate.ts.

Keep: all class methods, `upsErrorBodyParser` const, and the `satisfies CarrierProvider` check.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: 151+ pass, 0 fail (no behavior change, just moved types)

- [ ] **Step 4: Commit**

```bash
git add packages/carrier-ups/src/types.ts packages/carrier-ups/src/rate.ts
git commit -m "refactor(ups): extract UPS types to dedicated module"
```

### Subtask 2b: Extract auth module

- [ ] **Step 5: Create auth.ts with token management extracted from rate.ts**

Create `packages/carrier-ups/src/auth.ts`:

```typescript
import type { CarrierResult, FetchFn, Logger } from "@pidgeon/core";
import { upsError } from "./types.js";

export class UpsTokenManager {
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly timeoutMs: number,
    private readonly tokenExpiryBufferSeconds: number,
    private readonly logger: Logger | undefined,
  ) {}

  async getToken(): Promise<CarrierResult<string>> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return { ok: true, data: this.cachedToken.accessToken };
    }
    return this.acquireToken();
  }

  invalidate(): void {
    this.cachedToken = null;
  }

  private async acquireToken(): Promise<CarrierResult<string>> {
    this.logger?.info("acquiring token");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        return { ok: false, error: upsError("TIMEOUT", "token endpoint timeout", true) };
      }
      return { ok: false, error: upsError("AUTH", `token endpoint error: ${error instanceof Error ? error.message : String(error)}`) };
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { ok: false, error: upsError("AUTH", `UPS auth token error (${response.status})`) };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: upsError("AUTH", "Failed to parse token response as JSON") };
    }

    const body = json as Record<string, unknown>;
    const accessToken = body?.access_token;
    if (typeof accessToken !== "string") {
      return { ok: false, error: upsError("AUTH", "token response missing access_token") };
    }

    const rawExpiry = body.expires_in;
    const expiresIn = typeof rawExpiry === "number" ? rawExpiry : parseInt(String(rawExpiry), 10) || 0;
    this.cachedToken = {
      accessToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - this.tokenExpiryBufferSeconds) * 1000,
    };
    this.logger?.info("token acquired", { expiresIn });

    return { ok: true, data: accessToken };
  }
}
```

- [ ] **Step 6: Update rate.ts to use UpsTokenManager**

In `packages/carrier-ups/src/rate.ts`, replace the `cachedToken` field and the `getToken()` / `acquireToken()` methods with an instance of `UpsTokenManager`:

```typescript
import { UpsTokenManager } from "./auth.js";
```

In the constructor, create the token manager:

```typescript
private readonly tokenManager: UpsTokenManager;

constructor(config: UpsRateProviderConfig) {
  // ... existing field assignments ...
  this.tokenManager = new UpsTokenManager(
    this.fetchFn,
    this.tokenUrl,
    this.credentials.clientId,
    this.credentials.clientSecret,
    this.timeoutMs,
    this.tokenExpiryBufferSeconds,
    this.logger,
  );
}
```

In `executeWithToken()`, replace `this.getToken()` with `this.tokenManager.getToken()` and `this.cachedToken = null` with `this.tokenManager.invalidate()`.

Remove: `private cachedToken` field, `getToken()` method, `acquireToken()` method from rate.ts.

- [ ] **Step 7: Run full test suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add packages/carrier-ups/src/auth.ts packages/carrier-ups/src/rate.ts
git commit -m "refactor(ups): extract token management to auth module"
```

### Subtask 2c: Extract request builder

- [ ] **Step 9: Create request-builder.ts**

Create `packages/carrier-ups/src/request-builder.ts`:

```typescript
import type { Address, RateRequest } from "@pidgeon/core";

export function buildUpsRateRequest(request: RateRequest, accountNumber: string): unknown {
  return {
    RateRequest: {
      Request: {
        RequestOption: "Shop",
        SubVersion: "2108",
      },
      Shipment: {
        Shipper: {
          ShipperNumber: accountNumber,
          Address: mapAddress(request.origin),
        },
        ShipTo: {
          Address: mapAddress(request.destination),
        },
        ShipFrom: {
          Address: mapAddress(request.origin),
        },
        PaymentDetails: {
          ShipmentCharge: {
            Type: "01",
            BillShipper: {
              AccountNumber: accountNumber,
            },
          },
        },
        DeliveryTimeInformation: {
          PackageBillType: "03",
        },
        NumOfPieces: String(request.packages.length),
        Package: request.packages.map((pkg) => ({
          PackagingType: {
            Code: "02",
            Description: "Packaging",
          },
          Dimensions: {
            UnitOfMeasurement: {
              Code: mapDimensionUnit(pkg.dimensions.unit),
            },
            Length: String(pkg.dimensions.length),
            Width: String(pkg.dimensions.width),
            Height: String(pkg.dimensions.height),
          },
          PackageWeight: {
            UnitOfMeasurement: {
              Code: mapWeightUnit(pkg.weight.unit),
            },
            Weight: String(pkg.weight.value),
          },
        })),
      },
    },
  };
}

function mapAddress(address: Address): unknown {
  return {
    AddressLine: address.street,
    City: address.city,
    StateProvinceCode: address.state,
    PostalCode: address.postalCode,
    CountryCode: address.countryCode,
  };
}

export function mapWeightUnit(unit: string): string {
  const map: Record<string, string> = { lb: "LBS", kg: "KGS", oz: "OZS" };
  return map[unit] ?? unit.toUpperCase();
}

export function mapDimensionUnit(unit: string): string {
  const map: Record<string, string> = { in: "IN", cm: "CM" };
  return map[unit] ?? unit.toUpperCase();
}
```

- [ ] **Step 10: Update rate.ts to use request-builder.ts**

In `packages/carrier-ups/src/rate.ts`, replace `this.buildRequestBody(request)` call with:

```typescript
import { buildUpsRateRequest } from "./request-builder.js";
```

In `executeWithToken()`:

```typescript
const requestBody = buildUpsRateRequest(request, this.credentials.accountNumber);
```

Remove: `buildRequestBody()`, `mapAddress()`, `mapWeightUnit()`, `mapDimensionUnit()` methods from rate.ts.

- [ ] **Step 11: Run full test suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 12: Commit**

```bash
git add packages/carrier-ups/src/request-builder.ts packages/carrier-ups/src/rate.ts
git commit -m "refactor(ups): extract request builder to dedicated module"
```

### Subtask 2d: Extract response parser

- [ ] **Step 13: Create response-parser.ts**

Create `packages/carrier-ups/src/response-parser.ts`:

```typescript
import type { CarrierResult, RateQuote, ErrorBodyParser } from "@pidgeon/core";
import type { UpsRatedShipment, UpsErrorEnvelope } from "./types.js";
import { upsError } from "./types.js";

export const upsErrorBodyParser: ErrorBodyParser = (_status: number, body: unknown): string | null => {
  const envelope = body as UpsErrorEnvelope | null;
  const errors = envelope?.response?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => `${e.code}: ${e.message}`).join("; ");
  }
  return null;
};

export function parseUpsRateResponse(json: unknown): CarrierResult<RateQuote[]> {
  const envelope = json as Record<string, unknown> | null;
  const rateResponse = envelope?.RateResponse as Record<string, unknown> | undefined;
  if (!rateResponse) {
    return { ok: false, error: upsError("PROVIDER", "Invalid response: missing RateResponse") };
  }

  const ratedShipments = rateResponse.RatedShipment;
  if (!Array.isArray(ratedShipments)) {
    return { ok: false, error: upsError("PROVIDER", "Invalid response: missing RatedShipment") };
  }

  const quotes: RateQuote[] = [];
  for (const shipment of ratedShipments as UpsRatedShipment[]) {
    try {
      const totalCharge = parseFloat(shipment.TotalCharges?.MonetaryValue);
      if (Number.isNaN(totalCharge)) {
        return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable monetary value "${shipment.TotalCharges?.MonetaryValue}"`) };
      }

      const weight = parseFloat(shipment.BillingWeight?.Weight);
      if (Number.isNaN(weight)) {
        return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable weight "${shipment.BillingWeight?.Weight}"`) };
      }

      const timeInTransit = shipment.TimeInTransit?.ServiceSummary;
      if (!timeInTransit) {
        return { ok: false, error: upsError("PROVIDER", "Invalid response: missing TimeInTransit data") };
      }

      const rawTransitDays = parseInt(timeInTransit.EstimatedArrival.BusinessDaysInTransit, 10);
      const transitDays = Number.isNaN(rawTransitDays) ? null : rawTransitDays;

      const arrival = timeInTransit.EstimatedArrival.Arrival;
      let estimatedDelivery: Date | null = null;
      if (arrival?.Date) {
        const y = arrival.Date.slice(0, 4);
        const m = arrival.Date.slice(4, 6);
        const d = arrival.Date.slice(6, 8);
        const parsed = new Date(`${y}-${m}-${d}`);
        if (!Number.isNaN(parsed.getTime())) {
          estimatedDelivery = parsed;
        }
      }

      const surcharges: Array<{ type: string; amount: number }> = [];
      for (const pkg of shipment.RatedPackage ?? []) {
        for (const charge of pkg.ItemizedCharges ?? []) {
          const amount = parseFloat(charge.MonetaryValue);
          if (Number.isNaN(amount)) {
            return { ok: false, error: upsError("PROVIDER", `Invalid response: unparseable surcharge amount "${charge.MonetaryValue}"`) };
          }
          surcharges.push({ type: charge.SubType, amount });
        }
      }

      quotes.push({
        carrier: "UPS",
        serviceCode: shipment.Service.Code,
        serviceName: timeInTransit.Service.Description,
        totalCharge,
        currency: shipment.TotalCharges.CurrencyCode,
        transitDays,
        estimatedDelivery,
        billableWeight: {
          value: weight,
          unit: shipment.BillingWeight.UnitOfMeasurement.Code,
        },
        surcharges,
        guaranteed: timeInTransit.GuaranteedIndicator != null && timeInTransit.GuaranteedIndicator !== "",
      });
    } catch (error: unknown) {
      return { ok: false, error: upsError("PROVIDER", `Invalid response: malformed shipment data (${error instanceof Error ? error.message : String(error)})`) };
    }
  }

  return { ok: true, data: quotes };
}
```

- [ ] **Step 14: Update rate.ts to use response-parser.ts**

In `packages/carrier-ups/src/rate.ts`:

```typescript
import { upsErrorBodyParser, parseUpsRateResponse } from "./response-parser.js";
```

In `executeWithToken()`, replace `this.mapResponse(result.data.json)` with:

```typescript
const mapped = parseUpsRateResponse(result.data.json);
```

Remove: `mapResponse()` method and the `upsErrorBodyParser` const from rate.ts.

- [ ] **Step 15: Run full test suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 16: Commit**

```bash
git add packages/carrier-ups/src/response-parser.ts packages/carrier-ups/src/rate.ts
git commit -m "refactor(ups): extract response parser to dedicated module"
```

### Subtask 2e: Verify final state of rate.ts

- [ ] **Step 17: Read rate.ts and verify it is a thin orchestrator**

Read `packages/carrier-ups/src/rate.ts`. It should now contain only:
- Imports from `./types.js`, `./auth.js`, `./request-builder.js`, `./response-parser.js`, and `@pidgeon/core`
- The `UpsRateProvider` class with:
  - Constructor (creates `UpsTokenManager`, stores config)
  - `getRates()` (validates input, delegates to `executeWithToken`)
  - `executeWithToken()` (gets token, builds request via `buildUpsRateRequest`, calls `httpRequest`, handles auth retry, parses response via `parseUpsRateResponse`)
- The `satisfies CarrierProvider` check
- Re-export of `FetchFn`

The file should be ~80-100 lines. If it is significantly longer, something was not extracted.

- [ ] **Step 18: Run full test suite one final time**

Run: `bun test`
Expected: 151+ pass, 0 fail

---

## Task 3: Split CarrierProvider Into Capability Interfaces

**Review finding:** [HIGH] `CarrierProvider` mixes a concrete contract with speculative optional capabilities. "Method absent" is ambiguous.

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/carrier-ups/src/rate.ts` (update satisfies check)

- [ ] **Step 1: Split the interface in index.ts**

In `packages/core/src/index.ts`, replace the current `CarrierProvider` type (lines 58-63):

```typescript
// Before:
export type CarrierProvider = {
  getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>>;
  createLabel?(request: unknown): Promise<CarrierResult<unknown>>;
  validateAddress?(address: Address): Promise<CarrierResult<Address>>;
  getTracking?(trackingNumber: string): Promise<CarrierResult<unknown>>;
};

// After:
export type RateProvider = {
  getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>>;
};

export type LabelProvider = {
  createLabel(request: unknown): Promise<CarrierResult<unknown>>;
};

export type AddressValidationProvider = {
  validateAddress(address: Address): Promise<CarrierResult<Address>>;
};

export type TrackingProvider = {
  getTracking(trackingNumber: string): Promise<CarrierResult<unknown>>;
};

/**
 * A carrier that supports rating. This is the minimum required capability.
 * Carriers may also implement LabelProvider, AddressValidationProvider,
 * and/or TrackingProvider for additional operations.
 */
export type CarrierProvider = RateProvider;
```

The key insight: `CarrierProvider` becomes an alias for `RateProvider`. This means all existing code that references `CarrierProvider` continues to work with zero changes. The optional methods are removed — they were unused placeholders. The separate interfaces (`LabelProvider`, etc.) are available for future implementers.

- [ ] **Step 2: Update the satisfies check in rate.ts**

In `packages/carrier-ups/src/rate.ts`, the existing check still works because `CarrierProvider = RateProvider` and `UpsRateProvider` has `getRates()`. No change needed — but verify this compiles.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "refactor(core): split CarrierProvider into explicit capability interfaces"
```

---

## Task 4: Tighten Domain Enums

**Review finding:** [MEDIUM] Shared domain types are too stringly typed. Weight units, dimension units remain broad strings.

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/index.ts` (re-export new types)
- Test: existing tests in `packages/carrier-ups/src/request-builder.test.ts`

- [ ] **Step 1: Write test for valid unit rejection**

In `packages/core/src/schemas.ts`, we will constrain `unit` fields to known values. First, write a test that verifies the schema rejects an unknown unit.

Create or find the appropriate test location. If no `schemas.test.ts` exists, add to `packages/core/src/http.test.ts` or create a new file. The simplest approach: add a test to the existing test suite structure.

Create `packages/core/src/schemas.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { WeightSchema, DimensionsSchema, PackageSchema, RateRequestSchema } from "./schemas.js";

describe("WeightSchema", () => {
  it("accepts known weight units", () => {
    for (const unit of ["lb", "kg", "oz", "g"]) {
      const result = WeightSchema.safeParse({ value: 1, unit });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown weight units", () => {
    const result = WeightSchema.safeParse({ value: 1, unit: "stones" });
    expect(result.success).toBe(false);
  });
});

describe("DimensionsSchema", () => {
  it("accepts known dimension units", () => {
    for (const unit of ["in", "cm", "mm"]) {
      const result = DimensionsSchema.safeParse({ length: 1, width: 1, height: 1, unit });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown dimension units", () => {
    const result = DimensionsSchema.safeParse({ length: 1, width: 1, height: 1, unit: "furlongs" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/schemas.test.ts`
Expected: FAIL — current schema accepts any `string.min(1)`, so `"stones"` and `"furlongs"` pass validation.

- [ ] **Step 3: Tighten the schemas**

In `packages/core/src/schemas.ts`:

```typescript
import { z } from "zod";

export const WEIGHT_UNITS = ["lb", "kg", "oz", "g"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const DIMENSION_UNITS = ["in", "cm", "mm"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

export const WeightSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(WEIGHT_UNITS),
});

export const DimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(DIMENSION_UNITS),
});

// ... rest unchanged ...
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `bun test packages/core/src/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `bun test`

**Likely outcome:** Some tests may fail if they use unit strings not in the enum (e.g., `"LBS"` instead of `"lb"`). The domain model uses lowercase canonical units; carrier-specific codes like `"LBS"` live in carrier packages and are mapped at the boundary.

Check test fixtures in all test files. If fixtures use `"lb"` and `"in"`, all tests should pass. If any fixture uses carrier-specific codes, update those fixtures to use canonical units.

Expected: all tests pass.

- [ ] **Step 6: Export new types from index.ts**

In `packages/core/src/index.ts`, add exports:

```typescript
export type { WeightUnit, DimensionUnit } from "./schemas.js";
export { WEIGHT_UNITS, DIMENSION_UNITS } from "./schemas.js";
```

- [ ] **Step 7: Run full suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts packages/core/src/index.ts
git commit -m "refactor(core): constrain weight and dimension units to known enums"
```

---

## Task 5: Structured Aggregate Errors

**Review finding:** [MEDIUM] Structured carrier errors are flattened to a string at the aggregate boundary. `AggregatedRateResult` uses `error: string` for total failure.

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/registry.ts`
- Test: `packages/core/src/registry.test.ts`

- [ ] **Step 1: Write test for structured aggregate error**

In `packages/core/src/registry.test.ts`, add a test to the "getRatesFromAll" describe block that asserts the error is structured (not a flat string):

```typescript
it("returns structured error when all providers fail", async () => {
  const registry = new CarrierRegistry();
  registry.register("ups", failingProvider("UPS", "UPS is down"));
  registry.register("fedex", failingProvider("FedEx", "FedEx is down"));

  const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    // Error should be structured, not just a joined string
    expect(result.failures.length).toBe(2);
    // The error field should contain all failure messages for backward compat
    expect(result.error).toContain("UPS is down");
    expect(result.error).toContain("FedEx is down");
  }
});
```

**Note:** This test may already exist in a similar form. Read the existing tests first. If the current tests assert `result.error` is a semicolon-joined string, the test already passes. The real change here is adding a `structuredError` field or changing `error` from `string` to a richer type.

- [ ] **Step 2: Assess backward compatibility**

The `AggregatedRateResult` type is used by the CLI (`packages/core/src/cli.ts`). Changing `error: string` to a different type would break the CLI. The safest approach: keep `error: string` for backward compatibility (the joined summary) and ensure `failures` is the primary structured error channel.

Review the current test assertions. If they already assert both `error` (string) and `failures` (CarrierError[]), the current design already provides structured errors via `failures`. The `error: string` is a convenience summary.

If the existing tests and types already provide structured errors via `failures`, this finding may be **already addressed** by the existing design. In that case:

- [ ] **Step 3: Verify the existing design is sufficient**

Read `packages/core/src/registry.ts:51-52`. The current code:
```typescript
return { ok: false, error: failures.map((e) => e.message).join("; "), failures };
```

This returns both `error` (summary string) and `failures` (structured `CarrierError[]`). Callers who need structured errors use `result.failures`. Callers who need a quick message use `result.error`.

**Decision point:** If this is sufficient, document the finding as "already addressed by design" and skip to commit. If you want richer structure, consider adding a dedicated `AggregateError` type — but be cautious about complexity for complexity's sake.

- [ ] **Step 4: If changes were made, run full suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/registry.ts packages/core/src/registry.test.ts
git commit -m "refactor(core): document structured aggregate error contract via failures array"
```

---

## Task 6: Capability-Aware Registry

**Review finding:** [LOW] Registry is functional but too bare. A plain `Map<string, CarrierProvider>` does not carry enough structure for future extension.

**Files:**
- Modify: `packages/core/src/registry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/registry.test.ts`

- [ ] **Step 1: Write test for carrier descriptor registration**

In `packages/core/src/registry.test.ts`, add a new describe block:

```typescript
describe("carrier descriptors", () => {
  it("registers a carrier with capability metadata", () => {
    const registry = new CarrierRegistry();
    registry.register("ups", fakeProvider("UPS", 12.99), {
      capabilities: ["rate"],
    });

    const info = registry.describe("ups");
    expect(info).not.toBeNull();
    expect(info!.capabilities).toEqual(["rate"]);
  });

  it("lists carriers with their capabilities", () => {
    const registry = new CarrierRegistry();
    registry.register("ups", fakeProvider("UPS", 12.99), {
      capabilities: ["rate"],
    });
    registry.register("fedex", fakeProvider("FedEx", 10.99), {
      capabilities: ["rate", "label", "tracking"],
    });

    const all = registry.descriptions();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.name === "ups")?.capabilities).toEqual(["rate"]);
    expect(all.find((d) => d.name === "fedex")?.capabilities).toEqual(["rate", "label", "tracking"]);
  });

  it("defaults to rate-only when no descriptor provided", () => {
    const registry = new CarrierRegistry();
    registry.register("ups", fakeProvider("UPS", 12.99));

    const info = registry.describe("ups");
    expect(info).not.toBeNull();
    expect(info!.capabilities).toEqual(["rate"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/registry.test.ts`
Expected: FAIL — `register()` doesn't accept a descriptor, `describe()` and `descriptions()` don't exist.

- [ ] **Step 3: Implement capability-aware registry**

In `packages/core/src/index.ts`, add the descriptor type:

```typescript
export type CarrierCapability = "rate" | "label" | "addressValidation" | "tracking";

export type CarrierDescriptor = {
  readonly name: string;
  readonly capabilities: readonly CarrierCapability[];
};
```

In `packages/core/src/registry.ts`, update the class:

```typescript
import type {
  AggregatedRateResult,
  CarrierCapability,
  CarrierDescriptor,
  CarrierError,
  CarrierProvider,
  CarrierResult,
  RateRequest,
  Result,
} from "./index.js";

type RegistryEntry = {
  readonly provider: CarrierProvider;
  readonly descriptor: CarrierDescriptor;
};

export class CarrierRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(
    name: string,
    provider: CarrierProvider,
    descriptor?: { capabilities?: CarrierCapability[] },
  ): void {
    const key = name.toLowerCase();
    if (this.entries.has(key)) {
      throw new Error(`Carrier "${name}" is already registered`);
    }
    this.entries.set(key, {
      provider,
      descriptor: {
        name: key,
        capabilities: descriptor?.capabilities ?? ["rate"],
      },
    });
  }

  resolve(name: string): Result<CarrierProvider> {
    const entry = this.entries.get(name.toLowerCase());
    if (!entry) {
      return { ok: false, error: `Unknown carrier: ${name}` };
    }
    return { ok: true, data: entry.provider };
  }

  describe(name: string): CarrierDescriptor | null {
    return this.entries.get(name.toLowerCase())?.descriptor ?? null;
  }

  descriptions(): CarrierDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  carriers(): string[] {
    return [...this.entries.keys()];
  }

  async getRatesFromAll(request: RateRequest): Promise<AggregatedRateResult> {
    if (this.entries.size === 0) {
      return { ok: false, error: "No carriers registered", failures: [] };
    }

    const results = await Promise.all(
      [...this.entries.entries()].map(([name, { provider }]) =>
        provider.getRates(request).catch((err: unknown): CarrierResult<never> => ({
          ok: false,
          error: { code: "UNKNOWN", message: String(err), carrier: name, retriable: false },
        })),
      ),
    );

    const quotes: import("./index.js").RateQuote[] = [];
    const failures: CarrierError[] = [];

    for (const result of results) {
      if (result.ok) {
        quotes.push(...result.data);
      } else {
        failures.push(result.error);
      }
    }

    if (quotes.length === 0) {
      return { ok: false, error: failures.map((e) => e.message).join("; "), failures };
    }

    return { ok: true, data: quotes, failures };
  }
}
```

- [ ] **Step 4: Export new types from index.ts**

In `packages/core/src/index.ts`, add:

```typescript
export type { CarrierCapability, CarrierDescriptor } from "./index.js";
```

Wait — these types are defined directly in `index.ts`, so they're already exported by virtue of the `export type` declaration. No additional export line needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/src/registry.test.ts`
Expected: PASS

- [ ] **Step 6: Run full suite**

Run: `bun test`
Expected: 151+ pass, 0 fail

**Note:** The `register()` signature is backward-compatible: the third parameter is optional and defaults to `{ capabilities: ["rate"] }`. All existing callers that pass only `(name, provider)` continue to work.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/registry.ts packages/core/src/registry.test.ts
git commit -m "feat(core): capability-aware carrier registry with descriptors"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `bun test` — all tests pass
- [ ] `bun run build` — build succeeds
- [ ] `packages/carrier-ups/src/rate.ts` is under 120 lines
- [ ] No `CarrierProvider` type contains optional future methods
- [ ] `packages/core/src/http.ts` contains no carrier-specific wording
- [ ] `WeightSchema` and `DimensionsSchema` use `z.enum()` not `z.string()`
- [ ] Registry supports `describe()` and `descriptions()` methods
- [ ] Git log shows atomic commits, one concern each
