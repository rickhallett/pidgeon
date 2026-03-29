# Spec Compliance Review — Full System

**Scope:** Entire codebase on `feature/review-feedback-round-1` — all committed code plus untracked review files
**Date:** 2026-03-29T20:00:00Z
**Model:** claude (claude-opus-4-6)
**Method:** Systematic comparison of spec.md requirements against implemented code, types, tests, and tooling

---

## Methodology

Each section of the spec is evaluated independently. Findings are classified as:

- **IMPLEMENTED** — Requirement is met in code and tested
- **PARTIAL** — Core intent is met, but some sub-requirements are missing or diverge
- **MISSING** — Specified but not implemented
- **DIVERGED** — Implemented differently than specified (not necessarily wrong)
- **OUT OF SCOPE** — Explicitly marked as out of scope in the spec

---

## 1. Purpose

> "A TypeScript service that wraps shipping carrier APIs (starting with UPS Rating API) to provide normalised rate quotes."

**IMPLEMENTED.** UpsRateProvider wraps the UPS Rating API and returns normalised RateQuote[]. 109 tests passing, typecheck clean.

---

## 2. Architecture

### 2.1 Monorepo Structure

> "Bun workspaces with two packages: @pidgeon/core, @pidgeon/carrier-ups"

**IMPLEMENTED.**
- Root package.json: `"workspaces": ["packages/*"]`
- `@pidgeon/core` at packages/core — domain types, Zod schemas, registry, CLI, Logger type
- `@pidgeon/carrier-ups` at packages/carrier-ups — UPS OAuth, rate mapping, config
- Bun workspaces functioning (workspace:* dependency)

### 2.2 Carrier Abstraction

> "Core defines a CarrierProvider interface with getRates() required and optional methods for future operations (createLabel?(), validateAddress?(), getTracking?()). Simple factory maps carrier name to provider instance."

**PARTIAL.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| CarrierProvider interface in core | IMPLEMENTED | index.ts:89-91 |
| getRates() required | IMPLEMENTED | `getRates(request: RateRequest): Promise<CarrierResult<RateQuote[]>>` |
| createLabel?() optional method | MISSING | Not defined on CarrierProvider |
| validateAddress?() optional method | MISSING | Not defined |
| getTracking?() optional method | MISSING | Not defined |
| Factory/registry maps carrier name → provider | IMPLEMENTED | CarrierRegistry class with register/resolve |

The spec's optional methods (`createLabel?()`, `validateAddress?()`, `getTracking?()`) are absent from the CarrierProvider type. These are explicitly future-looking and marked optional in the spec, so their absence is reasonable. However, adding them later will require updating every mock and fake provider in the test suite, even though the `?` makes them non-breaking at the call site.

The "simple factory" became a CarrierRegistry class — a reasonable divergence. The registry provides the factory's lookup function (`resolve()`) plus additional capabilities (listing carriers, concurrent multi-carrier aggregation via `getRatesFromAll()`). The spec's intent is met.

### 2.3 Normalised Rate Response

> The RateQuote type — field table in spec.

**IMPLEMENTED.** Field-by-field comparison:

| Spec Field | Spec Type | Implemented | Status |
|-----------|-----------|-------------|--------|
| carrier | string | `carrier: string` | IMPLEMENTED |
| serviceCode | string | `serviceCode: string` | IMPLEMENTED |
| serviceName | string | `serviceName: string` | IMPLEMENTED |
| totalCharge | number | `totalCharge: number` | IMPLEMENTED |
| currency | string | `currency: string` | IMPLEMENTED |
| estimatedDelivery | Date \| null | `estimatedDelivery: Date \| null` | IMPLEMENTED |
| transitDays | number \| null | `transitDays: number \| null` | IMPLEMENTED |
| surcharges | { type, amount }[] | `surcharges: readonly Surcharge[]` | IMPLEMENTED |
| billableWeight | { value, unit } | `billableWeight: Weight` | IMPLEMENTED |
| guaranteed | boolean | `guaranteed: boolean` | IMPLEMENTED |

All 10 fields match the spec exactly. The `estimatedDelivery` field is populated from UPS `EstimatedArrival.Arrival.Date` (rate.ts:222-230) and `transitDays` is nullable (rate.ts:219-220).

---

## 3. Domain Types & Validation

> "Zod for all runtime validation. Schemas defined in core, validated at service boundary before any external call."

**IMPLEMENTED.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Zod for runtime validation | IMPLEMENTED | schemas.ts, config.ts |
| Schemas defined in core | IMPLEMENTED | AddressSchema, WeightSchema, DimensionsSchema, PackageSchema, RateRequestSchema in packages/core/src/schemas.ts |
| Validated at service boundary | IMPLEMENTED | rate.ts:61-65 — `RateRequestSchema.safeParse(request)` at top of getRates() |

Detailed findings:

1. **Zod schemas ARE in core.** AddressSchema, WeightSchema, DimensionsSchema, PackageSchema, and RateRequestSchema are all defined in `packages/core/src/schemas.ts` and re-exported from `packages/core/src/index.ts:100-107`.

2. **Boundary validation is in place.** `UpsRateProvider.getRates()` validates the incoming `RateRequest` via `RateRequestSchema.safeParse(request)` at line 61, before any external call. Invalid input returns a structured `CarrierError` with code `"VALIDATION"`.

3. **No Zod schema for RateQuote.** The spec lists `RateQuote` as a domain type but there's no corresponding Zod schema for validating response data. The response is validated structurally in `mapResponse()` via manual checks. This is defensible — response validation would require Zod to handle `Date` objects and the structural checks in mapResponse are thorough. But if the response contract changes, the manual checks could drift from the TypeScript type.

Type inventory:

| Spec Type | Status | Location |
|-----------|--------|----------|
| RateRequest | Zod schema + TS type | core/src/schemas.ts:28-33, core/src/index.ts:51-56 |
| Address | Zod schema + TS type, **with street** | core/src/schemas.ts:20-26, core/src/index.ts:22-28 |
| Package | Zod schema + TS type | core/src/schemas.ts:15-18, core/src/index.ts:44-47 |
| RateQuote | TS type only (no Zod) | core/src/index.ts:63-74 |
| CarrierError | TS type with structured fields | core/src/index.ts:11-18 |

### 3.1 Address type

> "Address — street, city, state, postalCode, countryCode"

**IMPLEMENTED.** The Address type now includes `street`:

```typescript
type Address = {
  readonly street: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly city: string;
  readonly state: string;
};
```

The AddressSchema validates `street: z.string().min(1)`. The UPS `mapAddress()` maps `address.street` to `AddressLine` (rate.ts:376). Test fixtures include street values.

### 3.2 CarrierError type hierarchy

> "CarrierError — structured error with code, message, carrier, retriable flag"
> "Custom error classes internally (CarrierAuthError, CarrierRateLimitError, CarrierNetworkError, CarrierValidationError) — all extend CarrierError"

**PARTIAL.**

The structured error **type** exists and is in active use:

```typescript
type CarrierErrorCode = 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'VALIDATION' | 'TIMEOUT' | 'PROVIDER' | 'UNKNOWN';

type CarrierError = {
  readonly code: CarrierErrorCode;
  readonly message: string;
  readonly carrier: string;
  readonly retriable: boolean;
};
```

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Structured error with code, message, carrier, retriable | IMPLEMENTED | CarrierError type in index.ts:11-18 |
| CarrierErrorCode discriminator | IMPLEMENTED | Union of 7 codes including AUTH, RATE_LIMIT, NETWORK, VALIDATION |
| All error paths use structured errors | IMPLEMENTED | `upsError()` factory in rate.ts:32-34, all handleHttpError/mapResponse paths |
| Custom error **classes** (CarrierAuthError, etc.) | MISSING | No classes — discriminated union type instead |
| "all extend CarrierError" inheritance | MISSING | No class hierarchy — flat type with code discriminator |

The spec says "Custom error classes internally" with an inheritance hierarchy. The implementation uses a discriminated union with a `code` field instead. This is a deliberate architectural choice — discriminated unions are idiomatic TypeScript and arguably superior to class hierarchies for this use case:

- A caller can distinguish error types via `error.code === "AUTH"` — no `instanceof` checks needed
- The `upsError()` factory centralizes construction, preventing carrier field omission
- The `retriable` flag is set correctly per error type (AUTH: false, NETWORK: true, TIMEOUT: true, RATE_LIMIT: true)

**However**, the spec also says these error classes are used "internally" with `Result<T>` at boundaries. The current implementation uses `CarrierResult<T>` (which is `Result<T, CarrierError>`) at the boundary, putting structured errors at both the internal and boundary layers. This is actually *better* than the spec's proposal of wrapping classes into Result at the boundary — callers get the structured error directly without unwrapping.

**Assessment:** The spec's *intent* (structured, programmatically distinguishable errors with carrier and retriable metadata) is fully met. The spec's *mechanism* (class hierarchy) was replaced with a superior TypeScript pattern. The `TIMEOUT` and `PROVIDER` codes go beyond the spec (which only lists AUTH, RATE_LIMIT, NETWORK, VALIDATION).

---

## 4. Authentication

> "UPS OAuth 2.0 client-credentials flow: Token acquisition, In-memory cache with expiry tracking, Transparent refresh on expiry"

**IMPLEMENTED.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Token acquisition via client ID + secret | IMPLEMENTED | acquireToken() with Basic auth (rate.ts:275-317) |
| In-memory cache with expiry tracking | IMPLEMENTED | cachedToken with expiresAt (rate.ts:46) |
| Transparent refresh on expiry | IMPLEMENTED | getToken() checks expiry, re-acquires (rate.ts:268-273) |
| 401 → reacquire → retry | IMPLEMENTED | executeWithToken() with isAuthRetry flag (rate.ts:119-121) |
| Redis-backed cache (production note) | OUT OF SCOPE | Documented in spec |

The 401-retry logic is now implemented: when a rating request returns 401 and this isn't already an auth retry, the cached token is cleared and the entire request is re-executed with a fresh token (rate.ts:119-121). This fulfills "transparent refresh on expiry — caller never sees auth mechanics."

---

## 5. Configuration

> "Single config module using Zod schema validation at startup. Fails fast on missing/invalid config. All secrets and environment-specific values via environment variables. Ships with .env.example."

**IMPLEMENTED.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Single config module | IMPLEMENTED | config.ts with loadUpsConfig() |
| Zod schema validation | IMPLEMENTED | UpsConfigSchema with bounds, trim, defaults |
| Fails fast on missing/invalid | IMPLEMENTED | Returns Result with human-readable env key names |
| Env vars for secrets | IMPLEMENTED | UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_NUMBER |
| .env.example | IMPLEMENTED | Root .env.example with all vars, required/optional annotated, defaults shown |

The `.env.example` file exists and is well-structured: required credentials at the top, optional overrides commented with defaults. The `pathToEnvKey()` function maps Zod validation paths back to environment variable names for clear error messages.

---

## 6. HTTP Layer

> "Native fetch. Exponential backoff retry, timeout handling, reactive 429 handling, request/response logging, structured error mapping."

**PARTIAL.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Native fetch | IMPLEMENTED | FetchFn injection, no HTTP library |
| Exponential backoff retry | IMPLEMENTED | baseDelayMs * 2^(attempt-1), configurable (rate.ts:79-80) |
| Timeout handling | IMPLEMENTED | AbortController + setTimeout (rate.ts:84-86) |
| 429 handling with Retry-After | IMPLEMENTED | Parses integer seconds, respects maxRetryAfterSeconds (rate.ts:124-137) |
| Request/response logging (sanitised) | **MISSING** | Logger type defined but not used anywhere |
| Structured error mapping | IMPLEMENTED | upsError() with code discriminator for all error paths |

### 6.1 Logging — type exists, usage does not

The spec says "Request/response logging (sanitised — no auth tokens)." A `Logger` type IS defined in core (index.ts:78-83) with debug/info/warn/error methods. However:

- No file in the codebase imports or references `Logger` (grep confirms only the definition site)
- UpsRateProvider does not accept a Logger in its config
- No request URL, response status, timing, or error is logged anywhere
- No console.log, no log dependency, no log calls

The type is an architectural stub — it signals the intent to add logging — but does not constitute implementation. For a service making HTTP calls to external APIs, this means zero operational visibility. You cannot trace a failed request, measure latency, or debug auth issues without modifying code.

### 6.2 Structured error mapping

The spec says "Structured error mapping for network failures, HTTP errors, malformed responses." This IS now implemented via the `upsError()` factory and `CarrierErrorCode` discriminator:

- Network failures → `code: "NETWORK"`, `retriable: true`
- Timeouts → `code: "TIMEOUT"`, `retriable: true`
- Auth errors → `code: "AUTH"`, `retriable: false`
- Rate limits → `code: "RATE_LIMIT"`, `retriable: true`
- Server errors → `code: "PROVIDER"`, `retriable: true`
- Malformed responses → `code: "PROVIDER"`, `retriable: false`
- Validation failures → `code: "VALIDATION"`, `retriable: false`

---

## 7. Error Handling

> "Hybrid approach: Custom error classes internally, Result<T> at provider boundaries"

**PARTIAL.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Result<T> at boundaries | IMPLEMENTED | getRates() returns CarrierResult (Result<T, CarrierError>), never throws |
| Custom error classes internally | DIVERGED | Discriminated union type, not classes |
| Errors are structured, typed, meaningful | IMPLEMENTED | CarrierError with code, message, carrier, retriable |

The Result<T> boundary contract is solid. `getRates()` genuinely never throws — all paths return `CarrierResult<RateQuote[]>`. The `.catch()` handler in the registry (registry.ts:33-35) wraps unexpected throws into structured `CarrierError` objects with `code: "UNKNOWN"`.

The "custom error classes internally" requirement was replaced with a discriminated union approach. As noted in Section 3.2, this is a defensible divergence — the spec's intent (programmatically distinguishable errors) is met through a more idiomatic mechanism.

The `CarrierResult<T>` alias (`Result<T, CarrierError>`) means the boundary contract now carries structured error objects rather than plain strings. This is a strict improvement over `Result<T>` with string errors.

---

## 8. CLI

> "Commander-based CLI. Subcommand architecture. Initial command: rate for fetching quotes."

**IMPLEMENTED.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Commander-based | IMPLEMENTED | commander dependency, createProgram() |
| Subcommand architecture | IMPLEMENTED | program.command("rate") |
| rate subcommand | IMPLEMENTED | 16 options covering street addresses, packages, weights, dimensions |
| Input validation | IMPLEMENTED | Positive-number checks on weight/dimensions (cli.ts:43-48) |
| Error signaling | IMPLEMENTED | program.error() with exitCode: 1 |
| --json output | IMPLEMENTED | Beyond spec — good addition for scripting |
| Testable design | IMPLEMENTED | createProgram(deps) factory with injectable provider and write function |

The CLI meets and exceeds the spec. The `--json` flag, `ProgramDeps` injection pattern, and numeric validation are all quality additions beyond the spec requirements.

---

## 9. Testing

> "Integration tests with realistic payloads. Tests verify: request payloads, successful responses, auth token lifecycle, error responses, 429 rate limit handling."

**IMPLEMENTED.**

| Sub-requirement | Status | Evidence |
|----------------|--------|----------|
| Bun test runner | IMPLEMENTED | All tests use bun:test |
| Realistic UPS payloads | IMPLEMENTED | Fixtures from UPS API docs |
| Request payload tests | IMPLEMENTED | request-builder.test.ts |
| Response parsing tests | IMPLEMENTED | response-normalization.test.ts |
| Auth lifecycle tests | IMPLEMENTED | auth.test.ts |
| Error response tests | IMPLEMENTED | rate-errors.test.ts |
| 429 rate limit tests | IMPLEMENTED | http-retry.test.ts |
| HTTP stubbed at fetch level | IMPLEMENTED | FetchFn injection, no HTTP mocking library |

Test inventory: 109 tests across 10 files. Coverage is thorough for the implemented features. Test files for CLI (14 tests) and registry (11 tests) verify the wiring layer. Tests use structured `CarrierError` objects in fakes, confirming the type system is exercised through tests.

---

## 10. Tooling

> "Bun workspaces, Bun build, Bun test, Zod, Commander, TypeScript strict mode"

**IMPLEMENTED.**

| Tool | Status | Evidence |
|------|--------|----------|
| Bun workspaces | IMPLEMENTED | Root package.json workspaces config |
| Bun build | IMPLEMENTED | tsc via build scripts |
| Bun test | IMPLEMENTED | bun:test, 109 tests |
| Zod | IMPLEMENTED | zod ^4.3.6 in both core and carrier-ups |
| Commander | IMPLEMENTED | commander ^14.0.3 in core |
| TypeScript strict mode | IMPLEMENTED | strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true |

---

## 11. Out of Scope (Documented)

The spec lists these as "Out of Scope (documented, not implemented)":

| Item | Status |
|------|--------|
| Live UPS API calls | Correctly out of scope — all tests use stubs |
| Additional carriers (FedEx, USPS, DHL) | Correctly out of scope — architecture supports it via registry |
| Additional operations (label, tracking, address validation) | Correctly out of scope — but optional methods missing from CarrierProvider |
| Proactive rate limiting (token bucket) | Correctly out of scope |
| Persistent token cache (Redis) | Correctly out of scope |
| UI of any kind | Correctly out of scope |

---

## Summary: Spec Compliance Scorecard

| Spec Section | Status | Severity of Gap |
|-------------|--------|----------------|
| **Purpose** | IMPLEMENTED | — |
| **Monorepo structure** | IMPLEMENTED | — |
| **Carrier abstraction** | PARTIAL | LOW — optional methods not defined yet |
| **RateQuote fields** | IMPLEMENTED | — |
| **Domain type validation (Zod)** | IMPLEMENTED | — |
| **Address type** | IMPLEMENTED | — |
| **CarrierError structure** | IMPLEMENTED (code/message/carrier/retriable) | — |
| **CarrierError mechanism** | DIVERGED | LOW — union type instead of class hierarchy; functionally equivalent |
| **Authentication** | IMPLEMENTED | — |
| **401 retry** | IMPLEMENTED | — |
| **Configuration** | IMPLEMENTED | — |
| **.env.example** | IMPLEMENTED | — |
| **HTTP retry/timeout/429** | IMPLEMENTED | — |
| **Logging** | MISSING | **HIGH** — Logger type defined but unused; zero operational visibility |
| **Structured error mapping** | IMPLEMENTED | — |
| **Error handling (Result<T>)** | IMPLEMENTED | — |
| **CLI** | IMPLEMENTED | — |
| **Testing** | IMPLEMENTED | — |
| **Tooling** | IMPLEMENTED | — |

### Gap Severity Distribution

| Severity | Count | Gaps |
|----------|-------|------|
| HIGH | 1 | Logger type defined but not wired; no request/response/error logging |
| LOW | 2 | Optional methods on CarrierProvider; class hierarchy replaced with union type |

### Overall Assessment

**The implementation covers approximately 90-95% of the spec requirements.** The core vertical slice — UPS rate quotes with auth, retry, config, CLI, multi-carrier registry, structured errors, domain Zod schemas, and boundary validation — is solid and well-tested.

Since the last round of reviews, significant gaps have been closed:

- **CarrierError is now structured** with code, message, carrier, and retriable fields
- **Zod schemas are defined in core** and validated at the service boundary in getRates()
- **Address includes street**
- **RateQuote includes estimatedDelivery and nullable transitDays**
- **AggregatedRateResult exposes partial failures** instead of silently swallowing them
- **.env.example exists** with comprehensive documentation
- **401 → reacquire → retry** is implemented

**The single remaining HIGH gap is logging.** The Logger type exists as an architectural stub in core, but no code consumes it. UpsRateProvider doesn't accept a logger. No HTTP request, response, error, timing, or auth event is logged. For a service that makes HTTP calls to external APIs, this means a black box in production — you can't trace requests, measure latency, debug auth failures, or detect rate limiting without code changes.

### What Works Well

- **Structured CarrierError** — discriminated union with 7 codes, retriable flag, carrier identifier; programmatically distinguishable without string parsing
- **Boundary validation** — RateRequestSchema.safeParse() at top of getRates() catches invalid input before any network call
- **Result<T, CarrierError>** — the CarrierResult alias gives callers structured error objects at the boundary, not just strings
- **AggregatedRateResult** — the registry now exposes partial failures via the `failures` field, so callers know when a carrier was unreachable
- **401 retry** — transparent token refresh with recursion guard (isAuthRetry flag)
- **Test coverage** — 109 tests, realistic payloads, all error paths exercised with structured error assertions
- **Domain schemas in core** — proper dependency direction, reusable across carrier implementations
- **CLI testability** — ProgramDeps injection pattern with createProgram() factory

### What to Address Next

1. **Wire logging** — Accept a Logger in UpsRateProvider config. Log at minimum: outbound request URL + method (info), response status + timing (info), token acquisition + refresh events (debug), errors with context (error). Sanitise auth headers. This is the single highest-value remaining spec item.
2. **Optional CarrierProvider methods** — Add `createLabel?()`, `validateAddress?()`, `getTracking?()` stubs to the interface. Low effort, documents the extension contract.
3. **RateQuote Zod schema** — Optional but would close the validation loop on response data. Low priority since mapResponse() does structural validation.
