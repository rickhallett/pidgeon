# Review of Review-Feedback Implementation — HTTP Layer Focus

**Scope:** All 7 commits on `feature/review-feedback-round-1` (8347edd..79c22c7)
**Date:** 2026-03-29T20:00:00Z
**Model:** claude (claude-opus-4-6)
**Method:** Line-by-line read of every changed file against the original review findings and spec

---

## What's genuinely fixed

| Finding | Status | Evidence |
|---------|--------|---------|
| Structured error classification | FIXED | `handleHttpError` returns `CarrierError` with code/carrier/retriable |
| Error body parsing fallback | FIXED | `handleHttpError` try/catch on `response.json()` falls to status-only error |
| Boundary validation | FIXED | `RateRequestSchema.safeParse()` gates `getRates()` at entry |
| Domain types aligned with spec | FIXED | `street`, `estimatedDelivery`, nullable `transitDays`, optional `serviceCode` |
| .env.example | FIXED | Comprehensive, includes optional config with defaults |
| Partial failure visibility in registry | FIXED | `AggregatedRateResult` carries `failures` on success path |

---

## Findings

### [HIGH] F1 — Logger is a paper guardrail

**Where:** `packages/core/src/index.ts:78-83`
**What:** `Logger` type is defined and exported. No function in the codebase accepts or calls it. No request, response, retry, or error event is logged anywhere. The review finding was "zero logging in the codebase" — that remains true.
**Why it matters:** Defining a type is not logging. The spec says "Request/response logging (sanitised — no auth tokens)." The HTTP layer still has zero observability.
**Fix:** Accept `Logger` in `UpsRateProviderConfig`. Log token acquisition, request dispatch, retry decisions, and error classification. Sanitize auth headers before logging.

### [HIGH] F2 — Types and schemas are disconnected and will drift

**Where:** `packages/core/src/index.ts` (hand-written types), `packages/core/src/schemas.ts` (Zod schemas)
**What:** The coder was instructed "Types should be inferred from schemas where possible: `type Address = z.infer<typeof AddressSchema>`." This was not done. Types and schemas are independently maintained with no compile-time link.
**Why it matters:** Add a field to the schema but not the type (or vice versa) and you have a silent validation gap. This is exactly the class of bug the Zod requirement was meant to prevent.
**Fix:** Replace hand-written domain types with `z.infer<>` from schemas. Use `z.array().readonly()` for the packages field to match the readonly constraint.

### [HIGH] F3 — `estimatedDelivery` date parsing is completely untested

**Where:** `packages/carrier-ups/src/rate.ts:222-230`
**What:** Date parsing logic (`YYYYMMDD` → `YYYY-MM-DD` → `new Date()`) has zero test coverage. Every test fixture omits the `Arrival` field from `EstimatedArrival`, so `estimatedDelivery` is always `null` in all tests.
**Why it matters:** This is "Right Answer, Wrong Work" — the field exists, tests pass, but the parsing behavior is unverified. If UPS changes date format or the slicing is off-by-one, no test catches it.
**Fix:** Add test fixtures with `Arrival: { Date: "20260401" }` and assert the parsed Date.

### [HIGH] F4 — `transitDays: null` path is untested

**Where:** `packages/carrier-ups/src/rate.ts:219-220`
**What:** `const transitDays = Number.isNaN(rawTransitDays) ? null : rawTransitDays;` — no fixture provides an unparseable `BusinessDaysInTransit`, so the null branch is never exercised.
**Why it matters:** The type was changed from `number` to `number | null` specifically to handle this case. Without a test, the null path is unverified.
**Fix:** Add fixture with missing or non-numeric `BusinessDaysInTransit` and assert `transitDays === null`.

### [MEDIUM] F5 — Auth "retry once" is actually "retry a full cycle"

**Where:** `packages/carrier-ups/src/rate.ts:119-121`
**What:** `executeWithToken(request, true)` starts a new loop of up to `maxAttempts` iterations. If fresh token works but rating returns transient 500, the auth-retry cycle retries that 500 up to 3 more times. Total worst case: 1 + 4 = 5 rating requests from one `getRates()` call. Commit says "retry once" — only true for token acquisition.
**Why it matters:** Blast radius is larger than documented. The test at `http-retry.test.ts:306-317` only covers 401→401 (2 calls), not 401→500→500→500→500 (5 calls).
**Fix:** Either (a) limit the auth-retry to a single attempt (not a full loop), or (b) update docs/comments to reflect "retry with fresh auth, including transient retries." Add a test for the 401→5xx→success path.

### [MEDIUM] F6 — Registry catch labels failed providers as "unknown" carrier

**Where:** `packages/core/src/registry.ts:31-36`
**What:** `.map()` on `this.providers.values()` loses the key. A throwing provider gets `carrier: "unknown"` in the catch handler.
**Why it matters:** Defeats the purpose of adding `carrier` to structured errors. When a provider throws (vs returns Result), the failure attribution is lost.
**Fix:** Use `this.providers.entries()` and pass the carrier name into the catch handler.

### [MEDIUM] F7 — AggregatedRateResult total-failure path discards structured errors

**Where:** `packages/core/src/registry.ts:51-52`, `packages/core/src/index.ts:95-97`
**What:** When all carriers fail, `CarrierError[]` is flattened to `failures.map(e => e.message).join("; ")`. The `AggregatedRateResult` failure branch uses `error: string` while the success branch carries `failures: readonly CarrierError[]`.
**Why it matters:** A caller checking error details on total failure gets string parsing instead of structured inspection — the exact problem the CarrierError type was introduced to solve.
**Fix:** Change failure branch to `{ ok: false; error: string; failures: readonly CarrierError[] }` and populate both.

### [LOW] F8 — CLI JSON output discards structured error fields

**Where:** `packages/core/src/cli.ts:82`
**What:** `JSON.stringify({ ok: false, error: result.error.message })` drops `code`, `carrier`, `retriable`.
**Why it matters:** `--json` is for programmatic consumers who benefit most from structured data.
**Fix:** Serialize the full CarrierError: `JSON.stringify({ ok: false, error: result.error })`.

---

## Summary

| Severity | Count | Findings |
|----------|-------|----------|
| HIGH | 4 | Logger paper guardrail; schema/type drift; estimatedDelivery untested; transitDays null untested |
| MEDIUM | 3 | Auth retry blast radius; registry carrier attribution; total-failure error flattening |
| LOW | 1 | CLI JSON error truncation |

The structural improvements (CarrierError type, Zod boundary validation, domain type alignment) are sound. The integration gaps — where structured data is introduced but then discarded or disconnected along the path — are the recurring pattern. The HTTP layer specifically: error classification is fixed, but logging (the other half of the HTTP review finding) remains absent.
