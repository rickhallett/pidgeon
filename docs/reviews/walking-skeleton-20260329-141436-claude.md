# Adversarial Review — Walking Skeleton

**Scope:** All commits since init (`1899a57..06494aa`)
**Date:** 2026-03-29T14:14:36Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 2 CRITICAL, 3 HIGH, 4 MEDIUM, 3 LOW

---

## CRITICAL

### [CRITICAL] CORRECTNESS — `getRates()` claims to never throw, but throws on every non-happy path

```
Where: packages/carrier-ups/src/rate.ts:21-51
What: Zero error handling. Any of these will throw an unstructured exception:
      - fetch() DNS failure / network error -> unhandled rejection
      - Non-JSON response body -> response.json() throws SyntaxError
      - Missing RateResponse or RatedShipment field -> TypeError: Cannot read properties of undefined
      - HTTP 401/400/500 -> attempts to parse error body as success envelope -> TypeError
Why it matters: The spec (spec.md:78) and CLAUDE.md both state: "getRates() returns Result<RateQuote[]>,
      never throws. Internal code may throw; caught and wrapped at the boundary."
      There is no boundary catch. The Result type is decorative -- the method CAN and WILL throw.
Evidence: No try/catch anywhere in the method. No response.ok check.
Suggested fix: Wrap the entire body in try/catch, return { ok: false, error: ... } on failure.
      Check response.ok before parsing JSON. Validate JSON shape before accessing nested fields.
```

### [CRITICAL] CORRECTNESS — No authentication header sent to UPS API

```
Where: packages/carrier-ups/src/rate.ts:23-25
What: The fetch call sends only Content-Type. No Authorization header with Bearer token.
      UPS API requires OAuth 2.0 (docs/ups-api-reference.md:17-18).
      Credentials are accepted in config (line 3-7) but never used.
Why it matters: Every real API call returns 401. The credentials config creates a false
      impression that auth is wired up.
Evidence: headers: { "Content-Type": "application/json" } -- no Authorization.
Suggested fix: Acknowledged as BUILD_ORDER step 7, but the credential acceptance in config
      is misleading. Either add a TODO comment on the unused credentials or don't accept them yet.
```

---

## HIGH

### [HIGH] TEST QUALITY — Right Answer, Wrong Work: test doesn't verify request side

```
Where: packages/carrier-ups/src/rate.test.ts:63-66
What: fakeFetch ignores all arguments -- URL, method, headers, body.
      buildRequestBody returns {} (line 54-57). The test passes because the stub
      never inspects what it receives.
Why it matters: You can break request building completely and the test stays green.
      This is the "Right Answer, Wrong Work" anti-pattern from CLAUDE.md.
      Specifically: "Can you break the claimed behaviour while keeping the test green?" -- YES.
Evidence: const fakeFetch = async () => new Response(...) -- no parameter inspection.
      buildRequestBody returns {} -- empty object sent to "UPS".
Suggested fix: At minimum, assert the URL and method in the stub. This is a walking skeleton
      so the body check can wait for BUILD_ORDER step 4, but the URL/method check is free.
```

### [HIGH] TYPE SAFETY — Double cast hides broken fetch signature

```
Where: packages/carrier-ups/src/rate.test.ts:70
What: fakeFetch as unknown as typeof globalThis.fetch
      The double-cast through unknown bypasses all type checking. The actual signature
      (() => Promise<Response>) doesn't match fetch's signature
      ((input: RequestInfo, init?: RequestInit) => Promise<Response>).
Why it matters: If getRates() starts passing arguments to fetch that matter (it will),
      this cast will silently swallow type errors in the test.
Evidence: The cast chain: as unknown as typeof globalThis.fetch
Suggested fix: Give fakeFetch the proper signature:
      const fakeFetch: typeof globalThis.fetch = async (_input, _init) => ...
```

### [HIGH] API CONTRACT — GuaranteedIndicator logic may be wrong

```
Where: packages/carrier-ups/src/rate.ts:48 vs docs/ups-api-reference.md:187-190
What: The code reads guaranteed from ServiceSummary.GuaranteedIndicator (line 48)
      but the actual UPS API response also has GuaranteedDelivery as a SEPARATE field
      (docs line 187-190). The API reference shows GuaranteedIndicator: "" (empty string)
      on the same RatedShipment that has GuaranteedDelivery with BusinessDaysInTransit: "2".
Why it matters: A service with GuaranteedDelivery data but empty GuaranteedIndicator
      would report guaranteed: false. The two fields may have different semantics.
Evidence: Line 48: guaranteed: shipment.TimeInTransit.ServiceSummary.GuaranteedIndicator !== ""
      API ref line 187-190: GuaranteedDelivery present with data, GuaranteedIndicator is "".
Suggested fix: Cross-reference with the actual UPS OpenAPI spec. Check if GuaranteedDelivery
      presence (not GuaranteedIndicator string) is the authoritative signal.
```

---

## MEDIUM

### [MEDIUM] API CONTRACT — Spec type diverges from implementation type

```
Where: spec.md:33 vs packages/core/src/index.ts:50-60
What: The spec defines estimatedDelivery: Date | null -- this field does not exist in RateQuote.
      The spec defines transitDays: number | null -- the type has transitDays: number (not nullable).
Why it matters: Callers following the spec will expect a field that doesn't exist.
      Non-guaranteed services may not have transit days, but the type forces a number.
Evidence: spec.md line 33: "estimatedDelivery | Date | null"
      core/src/index.ts: no estimatedDelivery field on RateQuote.
Suggested fix: Either update the spec to match the types, or add the missing field.
      Decide which is authoritative and sync.
```

### [MEDIUM] TYPE SAFETY — Loose string types where constrained unions belong

```
Where: packages/core/src/index.ts:20-34
What: Weight.unit is string, Dimensions.unit is string, Address.countryCode is string.
      CLAUDE.md convention: "No enum -- use as const objects or union types."
Why it matters: Nothing prevents unit: "bananas" or countryCode: "LMAO".
      The input uses "lb" and "in", UPS returns "LBS" and "IN" -- these are different
      string values for the same concept with no mapping or validation.
Evidence: weight: { value: 1, unit: "lb" } -> billableWeight: { value: 1.0, unit: "LBS" }
      Input and output use different unit conventions with no normalisation.
Suggested fix: Define unit unions (e.g., "lb" | "kg" | "oz") and map at the carrier boundary.
```

### [MEDIUM] CORRECTNESS — No validation that packages array is non-empty

```
Where: packages/core/src/index.ts:42
What: packages: readonly Package[] -- allows empty array.
Why it matters: UPS API requires at least one package. An empty array would send a malformed
      request. With the current no-error-handling, this produces an opaque crash.
Evidence: No Zod schemas exist yet (acknowledged), but even the type allows it.
Suggested fix: When Zod schemas arrive (BUILD_ORDER step 4), enforce minLength(1).
```

### [MEDIUM] TEST QUALITY — Fixture surcharge value doesn't match API reference

```
Where: packages/carrier-ups/src/rate.test.ts:39 vs docs/ups-api-reference.md:220
What: Test fixture has ItemizedCharges[0].MonetaryValue: "2.10".
      The API reference example has MonetaryValue: "0.00" for the same fuel surcharge.
Why it matters: Minor, but the test claims to use "a realistic UPS response payload
      from docs/ups-api-reference.md" (line 10). It doesn't -- it's modified.
      Future developers comparing test fixture to API reference will be confused.
Evidence: Test line 39: "2.10", API ref line 220: "0.00"
Suggested fix: Either match the API reference exactly or remove the claim about sourcing
      from the API reference.
```

---

## LOW

### [LOW] BUILD — No scripts in root package.json

```
Where: package.json:1-8
What: No "test" or "build" script. CLAUDE.md says bun run build works.
      bun test works via built-in discovery, but bun run build will fail.
Why it matters: CLAUDE.md is the onboarding doc. A new developer running bun run build
      gets an error on their first interaction.
Evidence: "scripts" key is entirely absent from package.json.
Suggested fix: Add "scripts": { "test": "bun test", "build": "..." } or similar.
```

### [LOW] PROJECT STRUCTURE — carrier-ups barrel export is empty

```
Where: packages/carrier-ups/src/index.ts:1
What: File contains only a comment. Exports nothing.
      UpsRateProvider is only importable via deep path ./src/rate.js.
Why it matters: The package.json "exports" field points to ./src/index.ts,
      so import { UpsRateProvider } from "@pidgeon/carrier-ups" doesn't work.
Evidence: // @pidgeon/carrier-ups -- entry point (and nothing else)
Suggested fix: Add export { UpsRateProvider } from "./rate.js";
```

### [LOW] PROJECT STRUCTURE — Missing Zod dependency

```
Where: packages/core/package.json, packages/carrier-ups/package.json
What: Zod is listed as a tool in spec.md and CLAUDE.md mentions Zod schemas in core.
      No Zod dependency exists anywhere.
Why it matters: Expected per BUILD_ORDER step 4-5. Not a bug now but the spec claims
      Zod is part of the architecture.
Evidence: No "zod" in any package.json.
Suggested fix: Add when schemas are implemented.
```

---

## Systemic Risk

The biggest pattern across these findings is the gap between **what the types and docs claim** and **what the code enforces at runtime**. The `Result<T>` return type, the credentials config, and the "realistic UPS response" claim are all examples of the spec running ahead of the implementation. This is expected in a walking skeleton -- but the test must not let that gap hide.

The single most impactful fix is making the test verify what was **sent** (not just what was received), because that's where the Right Answer, Wrong Work pattern lives.
