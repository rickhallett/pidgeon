# Spec Compliance Review — 2026-03-29T21:00:00Z

**Reviewer:** Claude Opus 4.6 (adversarial)
**Scope:** Full spec.md requirements vs current codebase
**Method:** Independent review — no prior reports consulted
**Test gate:** 117 tests, all passing
**Build gate:** FAILING (see F1)

---

## Verdict: 85–90% spec compliance

The domain model, carrier abstraction, and test coverage are strong. Two blocking issues prevent full compliance: the TypeScript build is broken, and operational logging is defined but never wired into any caller.

---

## Findings

### CRITICAL — C1: `bun run build` fails with type errors

**Evidence:** `bun run build` exits with 4 type errors in `packages/core/src/index.ts`:

```
src/index.ts(39,28): error TS2304: Cannot find name 'Weight'.
src/index.ts(58,21): error TS2304: Cannot find name 'RateRequest'.
src/index.ts(60,29): error TS2304: Cannot find name 'Address'.
src/index.ts(60,61): error TS2304: Cannot find name 'Address'.
src/cli.ts(53,64): error TS2731: Implicit conversion of a 'symbol' to a 'string' will fail at runtime.
```

**Root cause:** `export type { Weight, Address, RateRequest } from "./schemas.js"` re-exports the types but does not import them into the local module scope. They're used in `RateQuote.billableWeight`, `CarrierProvider.getRates()`, and `CarrierProvider.validateAddress?()` type definitions within the same file.

The `cli.ts` error is `issue.path[0]` in a template string — `path` elements can be `string | number` per Zod, but the template requires string.

**Impact:** The published package would ship without declaration files (`.d.ts`). Consumers importing from `@pidgeon/core` would get no type information. `bun test` passes because bun's runtime transpiler doesn't enforce `tsc` strictness.

**Spec reference:** "TypeScript strict mode" (Tooling section). Also CLAUDE.md: "`bun run build` — Build all packages."

**Severity:** CRITICAL. A library that can't produce type declarations is not shippable.

---

### HIGH — H1: Logger type defined, logging calls wired, but no caller ever injects a logger

**Evidence:**
- `Logger` type is exported from `@pidgeon/core` (index.ts:46-51)
- `UpsRateProvider` accepts `logger?: Logger` in config and calls it at 14 call sites (info, debug, warn, error)
- Zero test files reference "logger" in any form
- No production code ever constructs or injects a Logger instance
- The CLI (`cli.ts`) does not pass a logger when constructing a provider

**Spec reference:** "Request/response logging (sanitised — no auth tokens)" (HTTP Layer section)

**Gap:** The spec requires logging as a feature of the HTTP layer. The plumbing is half-done: the provider accepts and calls a logger, but:
1. No default logger implementation exists
2. No test verifies that logging actually fires
3. No test verifies that auth tokens are sanitised from log output
4. The CLI — the only runnable entry point — doesn't wire logging

**Severity:** HIGH. The logging infrastructure is skeletal. It would work *if* a caller injected a logger, but the "sanitised — no auth tokens" requirement is untested and the Authorization header is never logged (good), but the request/response payloads logged at debug level could include sensitive data from the UPS response that should be reviewed.

---

### HIGH — H2: No test exercises boundary validation via `RateRequestSchema.safeParse`

**Evidence:** `rate.ts:64-68` runs `RateRequestSchema.safeParse(request)` at the top of `getRates()`. No test in the entire suite sends an invalid `RateRequest` to `getRates()` to verify this path returns a structured validation error.

**Spec reference:** "Zod for all runtime validation. Schemas defined in core, validated at service boundary before any external call."

**Gap:** The validation code exists, but the spec's "validated at service boundary" requirement has zero test coverage at the provider boundary. The CLI tests validate Commander args, and config tests validate env vars, but the core contract — `getRates()` rejects malformed input with a VALIDATION error — is untested.

An unrelated code change could remove the `safeParse` call and no test would fail.

**Severity:** HIGH. Untested behaviour at the most important boundary.

---

### MEDIUM — M1: Spec says "Custom error classes internally" — implementation uses plain objects

**Spec text:** "Custom error classes internally (CarrierAuthError, CarrierRateLimitError, CarrierNetworkError, CarrierValidationError) — all extend CarrierError"

**Implementation:** A single `CarrierError` type (plain object with `code` discriminant) replaces the class hierarchy. The `upsError()` factory constructs these. There are no `CarrierAuthError`, `CarrierRateLimitError`, etc. classes anywhere.

**Assessment:** The discriminated union is arguably better design than a class hierarchy for this use case (serialisable, no prototype chain, works across module boundaries). The `code` field provides the same dispatch capability. But the spec explicitly names four error classes that don't exist.

**Severity:** MEDIUM. The spirit is met (structured, typed, meaningful errors), the letter is not.

---

### MEDIUM — M2: Spec says "Subcommand architecture" — only one command exists with no extensibility mechanism

**Spec text:** "Commander-based CLI as dev tooling. Subcommand architecture so the team can add commands as the service grows."

**Implementation:** `createProgram()` returns a single `Command` with one `rate` subcommand hardcoded. Adding a new command requires modifying `cli.ts` directly.

**Assessment:** Commander inherently supports `addCommand()`, so this is technically extensible, but there's no documented or tested pattern for how a team member would add a new subcommand. The factory doesn't return separate parts.

**Severity:** MEDIUM. Functionally adequate for the current scope, but the "so the team can add commands" part isn't facilitated.

---

### LOW — L1: `estimatedDelivery` not tested in walking skeleton

**Evidence:** `rate.test.ts` (walking skeleton) asserts every RateQuote field except `estimatedDelivery`. The fixture includes `Arrival: { Date: "20230104" }` which should produce a `Date` object, but no assertion checks it.

`response-normalization.test.ts` does test `estimatedDelivery` thoroughly (4 tests). This is a coverage gap only in the walking skeleton, not systemically.

**Severity:** LOW. Covered elsewhere, but the walking skeleton — the foundational test — doesn't verify a spec'd field.

---

### LOW — L2: `CarrierProvider` optional methods have `unknown` parameter/return types

**Evidence:**
```typescript
createLabel?(request: unknown): Promise<CarrierResult<unknown>>;
validateAddress?(address: Address): Promise<CarrierResult<Address>>;
getTracking?(trackingNumber: string): Promise<CarrierResult<unknown>>;
```

The spec says these exist on the interface for future operations. They're present, which is good. But `createLabel` and `getTracking` use `unknown` for both input and output — these provide zero type guidance for future implementers.

**Severity:** LOW. These are explicitly out of scope per spec ("not implemented, documented"). The placeholder types are acceptable for now.

---

### LOW — L3: No explicit boundary-contract test that `getRates()` never throws

**Evidence:** The spec says `getRates()` returns `Result<RateQuote[]>`, never throws. The error path tests verify `result.ok === false`, but none of them assert that the function doesn't throw — they rely on the implicit fact that if it threw, the assertion on `result.ok` would fail with a different error.

A more explicit test would catch the case where `getRates()` throws on an unexpected input that bypasses the try/catch (e.g., a non-object passed as request before safeParse).

**Severity:** LOW. The current tests implicitly verify this, but a deliberate "never throws" contract test would be stronger.

---

## Compliance Matrix

| Spec Requirement | Status | Notes |
|---|---|---|
| Bun workspaces, two packages | PASS | `@pidgeon/core`, `@pidgeon/carrier-ups` |
| `CarrierProvider` interface with `getRates()` required | PASS | Plus optional methods |
| Optional `createLabel?`, `validateAddress?`, `getTracking?` | PASS | L2: `unknown` types |
| Simple factory maps carrier name → provider | PASS | `CarrierRegistry` |
| `RateQuote` type with all 10 fields | PASS | All fields present and typed correctly |
| `estimatedDelivery: Date \| null` | PASS | Parsed from YYYYMMDD, 4 edge case tests |
| `transitDays: number \| null` | PASS | Nullable, 2 edge case tests |
| `surcharges: { type, amount }[]` | PASS | Multi-package aggregation tested |
| `billableWeight: { value, unit }` | PASS | |
| `guaranteed: boolean` | PASS | GuaranteedIndicator edge cases tested |
| Zod schemas in core | PASS | 5 schemas, types inferred |
| Validated at service boundary | PARTIAL | Code exists, H2: no test |
| `Address` with street, city, state, postalCode, countryCode | PASS | |
| `CarrierError` structured error | PASS | M1: objects not classes |
| `Result<T>` at provider boundaries, never throws | PASS | L3: implicit only |
| UPS OAuth client-credentials | PASS | 12 auth lifecycle tests |
| Token caching with expiry | PASS | Buffer-aware, tested |
| Transparent refresh on expiry | PASS | |
| Config: Zod schema validation at startup | PASS | `loadUpsConfig()` |
| Config: fails fast on invalid | PASS | 11 config tests |
| `.env.example` | PASS | All vars documented |
| Native fetch, no HTTP dependency | PASS | |
| Exponential backoff retry | PASS | Timing-verified test |
| Timeout handling | PASS | AbortController, 4-attempt test |
| 429 rate limit / Retry-After | PASS | Honour + cap + retry |
| Request/response logging (sanitised) | FAIL | H1: type-only, never wired |
| Structured error mapping | PASS | 7 error codes, carrier-tagged |
| Custom error classes internally | PARTIAL | M1: discriminated union instead |
| Commander CLI with `rate` subcommand | PASS | |
| Subcommand architecture | PARTIAL | M2: not extensibility-ready |
| Integration tests with realistic payloads | PASS | UPS fixture from API docs |
| Request payload correctly built | PASS | 8 request-builder tests |
| Response parsed and normalised | PASS | 14 normalisation tests |
| Auth lifecycle tested | PASS | 12 tests |
| Error responses tested | PASS | 13 error-path tests |
| 429 handling triggers retry | PASS | 2 retry-429 tests |
| TypeScript strict mode | PASS | `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalProperties` |
| `bun run build` succeeds | FAIL | C1: 4 type errors |
| `bun test` succeeds | PASS | 117 tests, 0 failures |

---

## Priority ordering for remediation

1. **C1** — Fix the build. Import `Weight`, `Address`, `RateRequest` locally in `index.ts`. Fix the symbol-to-string coercion in `cli.ts`. This is a 5-line fix.
2. **H2** — Add boundary validation tests: pass invalid requests to `getRates()`, assert VALIDATION error code.
3. **H1** — Decide on logging strategy: either implement a default console logger and wire it, or document it as out-of-scope. Add a test that verifies logger receives calls and that auth tokens don't appear in logged metadata.
4. **M1/M2** — Document the deviation from spec (error classes → discriminated union, CLI extensibility pattern). These are reasonable architectural choices but should be recorded in devlog.yml.
