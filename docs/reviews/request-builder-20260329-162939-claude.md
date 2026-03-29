# Adversarial Review — Request Builder + Error Hardening

**Scope:** Commits `d5a16e0..1c4373d` (FetchFn fix, assertion strengthening, edge case tests, request builder)
**Date:** 2026-03-29T16:29:39Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 2 HIGH, 3 MEDIUM, 3 LOW

---

## Previous Review Status

From `error-paths-20260329-161444-claude.md`:

| Finding | Status |
|---------|--------|
| CRITICAL: typecheck fails (13 TS errors) | **RESOLVED** — `makeProvider` uses `FetchFn`; `rate.test.ts` uses `FetchFn`; both gates green |
| HIGH: mapResponse throws uncaught on malformed shipment | **PARTIALLY RESOLVED** — optional chaining added for TotalCharges, BillingWeight, TimeInTransit; explicit TimeInTransit check added (line 102-105). BUT: see HIGH #1 below |
| HIGH: weak `toBeDefined()` assertions | **RESOLVED** — empty object asserts `toContain("RateResponse")`, missing RatedShipment asserts `toContain("RatedShipment")`, unparseable monetary asserts `toContain("monetary")` |
| MEDIUM: surcharge NaN not validated | **RESOLVED** — NaN guard at rate.ts:116-118, test at rate-errors.test.ts:330-372 |
| MEDIUM: Retry-After untested | **OPEN** — acknowledged as BUILD_ORDER step 8 |
| MEDIUM: no 400+HTML test | **RESOLVED** — test at rate-errors.test.ts:315-328 |
| LOW: dead UpsRateResponseEnvelope | **OPEN** — still unused at rate.ts:216-220 |
| LOW: rate.test.ts double-cast | **RESOLVED** — uses `FetchFn` now |

**Carried from walking skeleton review:**

| Finding | Status |
|---------|--------|
| Test doesn't verify request side | **RESOLVED** — `request-builder.test.ts` captures and verifies full payload |
| GuaranteedIndicator logic | **OPEN** |
| Empty barrel export | **OPEN** |
| Spec/type divergence (estimatedDelivery) | **OPEN** |

---

## HIGH

### [HIGH] CORRECTNESS — mapResponse still throws uncaught TypeError if Service.Code is missing

```
Where: packages/carrier-ups/src/rate.ts:91, 125
What: Optional chaining was added for TotalCharges, BillingWeight, and
      TimeInTransit (lines 92, 97, 102). But the cast on line 91:

        for (const shipment of ratedShipments as UpsRatedShipment[])

      still trusts that each element has a Service property. If a shipment
      element has no Service field, line 125:

        serviceCode: shipment.Service.Code

      throws TypeError: Cannot read properties of undefined (reading 'Code').

      Similarly, if TotalCharges exists but CurrencyCode is missing (line 128),
      or BillingWeight.UnitOfMeasurement is missing (line 132), those will
      throw uncaught.

      The optional chaining only guards the fields that are checked with
      parseFloat/parseInt. Fields that are read directly (Service.Code,
      TotalCharges.CurrencyCode, BillingWeight.UnitOfMeasurement.Code,
      Service.Description) have no guard.

Why it matters: A RatedShipment like:
      { TotalCharges: { CurrencyCode: "USD", MonetaryValue: "10.00" },
        BillingWeight: { UnitOfMeasurement: { Code: "LBS" }, Weight: "1.0" },
        RatedPackage: [],
        TimeInTransit: { ServiceSummary: { ... } } }
      (missing Service) would crash with an unstructured TypeError,
      bypassing the Result<T> boundary.

Evidence: No test for a shipment missing Service. No try/catch around the
      quote-building block (lines 123-136).

Suggested fix: Either:
      (a) Wrap lines 91-137 in try/catch → return { ok: false, error: ... }, or
      (b) Validate every required nested field before access (more verbose but
          produces better error messages).
      Option (a) is simpler and closes the entire class of missing-field errors.
```

### [HIGH] API CONTRACT — Request builder sends wrong URL for "Rate" option

```
Where: packages/carrier-ups/src/rate.ts:26
What: The URL is hardcoded to:
      https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit

      The UPS API endpoint format is (per docs/ups-api-reference.md:7-9):
      /rating/{version}/{requestoption}

      The request body also sends RequestOption: "Shoptimeintransit" (line 147).
      This is correct for getting all services WITH time-in-transit data.

      HOWEVER: the URL path and the body's RequestOption must be consistent.
      The current code gets this right, but the endpoint is baked into
      the class with no way to change it.

      If a caller needs a specific service rate (RequestOption: "Rate"
      with a specific Service.Code in the request), the URL would need
      to be /rating/v2409/Rate — but the URL is hardcoded.

      More critically: the original walking skeleton test (rate.test.ts)
      was built against the URL /rating/v2409/Rate. The URL was silently
      changed to /rating/v2409/Shoptimeintransit in this commit. The
      walking skeleton test still passes because it doesn't verify the URL.

Why it matters: The walking skeleton test's fetch stub doesn't inspect the URL,
      so the endpoint could be changed to anything without test failure.
      The request-builder test DOES verify the URL (line 227), which is good —
      but the walking skeleton is now testing against a different URL than
      it was designed for, without acknowledgement.

Evidence:
      rate.ts:26   → /Shoptimeintransit (current)
      rate.test.ts → no URL assertion (walking skeleton)
      request-builder.test.ts:227 → asserts /Shoptimeintransit (new test)

Suggested fix: Not a bug per se — the URL is correct for the current use case.
      But document why Shoptimeintransit was chosen over Rate, and consider
      whether the walking skeleton test should now assert the URL too.
```

---

## MEDIUM

### [MEDIUM] API CONTRACT — Missing AddressLine field in UPS request payload

```
Where: packages/carrier-ups/src/rate.ts:194-201
What: The mapAddress method produces:
      { City, StateProvinceCode, PostalCode, CountryCode }

      The UPS API reference (docs/ups-api-reference.md:66-69) shows
      AddressLine as a field in every address:
      "AddressLine": "123 main street"

      The domain Address type doesn't have a street field either
      (core/src/index.ts:12-16), so this is consistent — but it means
      the request payload diverges from the API reference shape.

Why it matters: The UPS Rating API may require AddressLine for accurate
      quotes (residential vs commercial detection, address validation).
      Omitting it may produce less accurate rates or trigger validation
      errors with certain address combinations.

Evidence: API reference shows AddressLine in all three address blocks.
      mapAddress omits it. Address type has no street/line field.

Suggested fix: Add addressLine (or street) to the core Address type
      and pass it through. If deliberately omitted, document why.
```

### [MEDIUM] TEST QUALITY — Missing TimeInTransit test uses weak toBeDefined() assertion

```
Where: packages/carrier-ups/src/rate-errors.test.ts:312
What: The new test for "shipment element missing TimeInTransit" (line 288)
      only asserts:
        expect(result.error).toBeDefined()

      All other recently-fixed assertions use toContain() with specific
      substrings. This one was added after the strengthening pass but
      uses the old weak pattern.

      The implementation returns "Invalid response: missing TimeInTransit data"
      (rate.ts:104) — there's a perfectly good substring to assert against.

Evidence: Line 312: expect(result.error).toBeDefined()
      vs rate.ts:104: "missing TimeInTransit data"

Suggested fix: expect(result.error).toContain("TimeInTransit")
```

### [MEDIUM] TEST QUALITY — capturingFetch doesn't validate JSON.parse safety

```
Where: packages/carrier-ups/src/request-builder.test.ts:47
What: captured = { url: input, init, body: JSON.parse(bodyStr) }

      If init?.body is undefined or not a string, bodyStr becomes ""
      and JSON.parse("") throws a SyntaxError. The capturingFetch helper
      would crash the test with an opaque error.

      This can't happen with the current implementation (buildRequestBody
      always returns an object that JSON.stringify produces a string for),
      but if someone writes a test where fetch is called without a body,
      they get SyntaxError instead of a helpful failure.

Why it matters: Test infrastructure should fail clearly. A SyntaxError
      in a helper is confusing to debug.

Evidence: Line 46: const bodyStr = typeof init?.body === "string" ? init.body : ""
      JSON.parse("") → SyntaxError: Unexpected end of JSON input

Suggested fix: Either default to `body: null` when bodyStr is "",
      or wrap in try/catch with a descriptive error.
```

---

## LOW

### [LOW] TEST QUALITY — Request builder tests use `as any` for payload access

```
Where: packages/carrier-ups/src/request-builder.test.ts:87, 105, 123, 141, 164, 181, 198, 212
What: Every assertion casts captured().body as any:
      const shipFrom = captured().body as any;

      This works but defeats type checking on the assertion side. If a
      field name is typo'd in the test (e.g., ShipperNunber), TypeScript
      won't catch it.

Why it matters: Low risk — the tests are verifying the payload shape, so
      a typo in the test just means a failing assertion (which is the
      intended behaviour). But a typed UPS request payload type would
      catch this at compile time.

Evidence: 8 instances of `as any` across request-builder tests.

Suggested fix: Define a UpsRateRequestPayload type and cast to that
      instead of any. This would also serve as documentation of the
      expected request shape.
```

### [LOW] CODE — UpsRateResponseEnvelope type is still dead code

```
Where: packages/carrier-ups/src/rate.ts:216-220
What: Carried from previous review. The type is defined but never used.
      mapResponse uses manual Record casts instead.

Suggested fix: Remove it.
```

### [LOW] CODE — Unit mapping uses fallback that silently uppercases unknown units

```
Where: packages/carrier-ups/src/rate.ts:204-205, 209-210
What: mapWeightUnit and mapDimensionUnit fall back to unit.toUpperCase()
      for unknown units. So unit: "kilogram" becomes "KILOGRAM", which
      UPS won't recognise.

Why it matters: Silent wrong behaviour is worse than a clear error.
      A misspelled unit produces a plausible-looking but invalid request.
      UPS will reject it, but the error will come from UPS, not from
      validation.

Evidence: map[unit] ?? unit.toUpperCase() — the fallback looks intentional
      but produces garbage for non-abbreviated units.

Suggested fix: When Zod validation arrives (BUILD_ORDER step 4), constrain
      the input units to known values. Until then, this is acceptable as
      a defensive measure — just noting the silent degradation.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | Previous CRITICALs all resolved |
| HIGH | 2 | Uncaught TypeError on missing Service/nested fields; URL change without walking skeleton awareness |
| MEDIUM | 3 | Missing AddressLine; weak TimeInTransit assertion; fragile JSON.parse in test helper |
| LOW | 3 | `as any` in tests; dead type; silent unit fallback |

## Trend

The codebase is improving with each iteration. The error boundary is substantively real now — it catches fetch, HTTP, JSON parse, top-level shape, and numeric parsing errors. The remaining gap is a single category: **direct property access on cast types without guards**. The `as UpsRatedShipment[]` cast on line 91 grants trust to every nested field, but only some fields are validated before access. A single try/catch around the quote-building loop (lines 91-137) would close this entire class.

The request builder is well-structured and well-tested. The `capturingFetch` pattern is a good solution to the "Right Answer, Wrong Work" problem from the walking skeleton review.
