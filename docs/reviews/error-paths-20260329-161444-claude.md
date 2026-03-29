# Adversarial Review — Error Paths

**Scope:** Commits `ae613af..c5422f5` (error path tests, error boundary implementation, build scripts)
**Date:** 2026-03-29T16:14:44Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 1 CRITICAL, 2 HIGH, 3 MEDIUM, 2 LOW

---

## Previous Review Status

From `walking-skeleton-20260329-141436-claude.md`:

| Finding | Status |
|---------|--------|
| CRITICAL: getRates() has no error boundary | **RESOLVED** — try/catch + response.ok + JSON parse guard + mapResponse validation |
| CRITICAL: No auth header | **OPEN** — acknowledged as BUILD_ORDER step 7 |
| HIGH: Test doesn't verify request side | **OPEN** — acknowledged as BUILD_ORDER step 4 |
| HIGH: Double cast hides fetch signature | **PARTIALLY RESOLVED** — `FetchFn` type exported from rate.ts, but error test uses `typeof globalThis.fetch` (see CRITICAL below) |
| HIGH: GuaranteedIndicator logic | **OPEN** |
| LOW: No scripts in root package.json | **RESOLVED** — build, typecheck, test scripts added |
| LOW: Empty barrel export | **OPEN** |
| LOW: Missing Zod dependency | **OPEN** — expected per BUILD_ORDER |

---

## CRITICAL

### [CRITICAL] BUILD — `bun run typecheck` fails: 13 errors in rate-errors.test.ts

```
Where: packages/carrier-ups/src/rate-errors.test.ts:41, 56, 68, 80, 108, 124, 139, 154, 172, 187, 206, 221, 236, 256
What: makeProvider accepts `typeof globalThis.fetch` but every lambda passed to it
      fails with:
        TS2345: Property 'preconnect' is missing in type '() => Promise<never>'
        but required in type 'typeof fetch'.

      Bun's fetch type includes a `preconnect` static method. Arrow functions
      don't have it. `typeof globalThis.fetch` is not just a callable — it's
      a function object with extra properties.

      Meanwhile, rate.ts:9 exports FetchFn — a proper callable type that
      the config ACTUALLY uses. The error test file ignores this and
      references the wrong type.

Why it matters: CLAUDE.md standing order: "Gate — change is ready only when
      bun test is green." Tests pass at runtime (bun test = 14 pass), but
      the typecheck gate is red. The type system cannot verify the test code.
      This is a false green — the gate is only checking one of two signals.

Evidence:
      rate.ts:9      → export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
      rate.ts:12     → readonly fetch: FetchFn;
      rate-errors.test.ts:41 → function makeProvider(fakeFetch: typeof globalThis.fetch)
      bun run typecheck → 13 errors, all the same root cause.

Suggested fix: Change makeProvider signature from:
      function makeProvider(fakeFetch: typeof globalThis.fetch): UpsRateProvider
      to:
      import type { FetchFn } from "./rate.js";
      function makeProvider(fakeFetch: FetchFn): UpsRateProvider

      Also fix rate.test.ts:70 which still uses `as unknown as typeof globalThis.fetch`.
```

`★ Insight: This is a split-gate problem. bun test exercises runtime behaviour (values), tsc exercises static correctness (types). When only one gate is checked, defects in the other gate's domain accumulate silently. The CLAUDE.md gate rule should be interpreted as "bun test AND bun run typecheck".`

---

## HIGH

### [HIGH] CORRECTNESS — mapResponse throws uncaught TypeError on malformed shipment elements

```
Where: packages/carrier-ups/src/rate.ts:91
What: for (const shipment of ratedShipments as UpsRatedShipment[])

      The code validates that RatedShipment is an array (line 86),
      but each element is cast to UpsRatedShipment without validation.
      If a shipment is missing TotalCharges, BillingWeight, or TimeInTransit,
      the code throws a TypeError at lines 92/97/102 — INSIDE mapResponse,
      which has no try/catch.

      Since mapResponse is called from getRates (line 49), and getRates
      has no catch around this call, the TypeError propagates as an
      unstructured exception — bypassing the Result<T> boundary contract.

Why it matters: The error boundary is incomplete. It catches:
      - fetch errors (line 31)
      - HTTP errors (line 38)
      - JSON parse errors (line 45)
      But NOT mapping errors. A RatedShipment like:
      { Service: { Code: "03" } }
      (missing all other fields) will crash uncaught.

Evidence: No test for a shipment element with missing nested fields.
      mapResponse has no try/catch. getRates does not wrap mapResponse in try/catch.

Suggested fix: Either:
      (a) Wrap mapResponse call in try/catch at line 49, or
      (b) Validate each shipment's required fields before access, or
      (c) Wrap the for-loop body in try/catch inside mapResponse.
      Also: add test for malformed shipment element.
```

### [HIGH] TEST QUALITY — Three assertions use toBeDefined() instead of specific error content

```
Where: packages/carrier-ups/src/rate-errors.test.ts:232, 252, 285
What: These tests assert only expect(result.error).toBeDefined():
      - "valid JSON but empty object" (line 232)
      - "RatedShipment is missing" (line 252)
      - "MonetaryValue not a parseable number" (line 285)

      The implementation DOES produce specific messages:
      - "Invalid response: missing RateResponse" (rate.ts:82)
      - "Invalid response: missing RatedShipment" (rate.ts:87)
      - "Invalid response: unparseable monetary value..." (rate.ts:94)

      But the tests don't verify them. Any non-empty error string passes.

Why it matters: These tests would stay green if the error messages were
      swapped, garbled, or replaced with "unknown error". They prove an
      error occurred, not that the RIGHT error occurred. This is the
      weak end of the assertion spectrum.

Evidence: Compare with network tests which assert toContain("network"),
      toContain("auth"), toContain("rate limit") — specific and meaningful.

Suggested fix: Strengthen to:
      - line 232: expect(result.error).toContain("RateResponse")
      - line 252: expect(result.error).toContain("RatedShipment")
      - line 285: expect(result.error).toContain("NOT_A_NUMBER") or toContain("monetary")
```

---

## MEDIUM

### [MEDIUM] CORRECTNESS — Surcharge amounts not validated for NaN

```
Where: packages/carrier-ups/src/rate.ts:121
What: amount: parseFloat(charge.MonetaryValue)
      The code validates totalCharge (line 93), weight (line 98), and
      transitDays (line 103) for NaN — but not surcharge amounts.
      A surcharge with MonetaryValue: "" or "N/A" produces amount: NaN.

Why it matters: NaN in a financial field is worse than returning an error.
      Downstream arithmetic (summing surcharges) produces NaN, which
      propagates silently through the system.

Evidence: Lines 91-104 have NaN guards. Line 121 does not.
      No test for surcharges with unparseable MonetaryValue.

Suggested fix: Apply the same NaN guard. Add a test.
```

### [MEDIUM] TEST QUALITY — 429 test sets Retry-After header but never verifies it's captured

```
Where: packages/carrier-ups/src/rate-errors.test.ts:158-159
What: The test includes Retry-After: "30" in the response headers,
      but only asserts result.error contains "rate limit".
      handleHttpError (rate.ts:52-76) never reads the Retry-After header.

Why it matters: The header creates an appearance of Retry-After testing
      without actual coverage. The spec (spec.md:72) calls for
      "Retry-After header parsing" — this is not implemented or tested.

Evidence: headers: { "Retry-After": "30" } — set but never read or asserted.

Suggested fix: Either capture Retry-After in a structured error (for BUILD_ORDER
      step 8) or remove the header from the test fixture to avoid false coverage.
```

### [MEDIUM] TEST QUALITY — No test for HTTP 400 with non-JSON body

```
Where: packages/carrier-ups/src/rate-errors.test.ts:94-199
What: The 400 test sends valid JSON. The 500 and 503 tests send plain text.
      There is no test for a 400 with a non-JSON body (e.g., HTML from a WAF
      or load balancer).

Why it matters: handleHttpError tries response.json() first (line 57).
      On a non-JSON 400, it catches, falls through to:
      return { ok: false, error: "UPS HTTP error (400)" }
      This path works but is untested. Real-world proxies and WAFs
      commonly return HTML on 400s.

Evidence: All 4xx tests use JSON bodies. Only 5xx tests use plain text.

Suggested fix: Add one test: 400 with HTML body, assert error contains "400".
```

---

## LOW

### [LOW] CODE — UpsRateResponseEnvelope type is dead code

```
Where: packages/carrier-ups/src/rate.ts:139-143
What: UpsRateResponseEnvelope is defined but never referenced.
      mapResponse uses manual unknown -> Record casts instead.

Evidence: No usage found outside the type definition itself.
Suggested fix: Remove the dead type.
```

### [LOW] TEST QUALITY — rate.test.ts still uses double-cast for fetch

```
Where: packages/carrier-ups/src/rate.test.ts:70
What: fetch: fakeFetch as unknown as typeof globalThis.fetch
      The error test introduced makeProvider() as a helper, and rate.ts
      introduced FetchFn. But the original walking skeleton test still
      uses the unsafe double-cast pattern.

Why it matters: Inconsistent patterns between the two test files.
      The walking skeleton test bypasses type checking that the error
      test now (attempts to) enforce.

Suggested fix: Import FetchFn, use it for fakeFetch signature in rate.test.ts too.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 1 | Typecheck gate is red — 13 TS errors in test file |
| HIGH | 2 | Uncaught TypeError in mapResponse; weak toBeDefined() assertions |
| MEDIUM | 3 | Surcharge NaN; Retry-After untested; no 400+HTML test |
| LOW | 2 | Dead type; inconsistent fetch cast |

## Systemic Observation

The error boundary implementation is solid for the paths it covers — network, HTTP, JSON parse, top-level shape. The remaining gap is a single pattern: **validate the envelope, trust the contents**. The RatedShipment array is validated as an array, but its elements are cast without checking nested structure. This same pattern applies to surcharge amounts. The fix for both is the same: either catch errors from the cast access, or validate before access.

The typecheck failure is the most urgent item. It means the gate is split — `bun test` green, `tsc` red — and only the green half is being checked.
