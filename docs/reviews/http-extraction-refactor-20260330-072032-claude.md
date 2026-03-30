# Refactoring Review: HTTP Transport Layer Extraction

- **Scope:** Extraction of shared HTTP transport from `@pidgeon/carrier-ups` into `@pidgeon/core`, plus subsequent decomposition of `UpsRateProvider` into focused modules
- **Commits reviewed:** `25ce7f8` through `e2feef3` (8 commits total)
- **Reviewer:** Claude Opus 4.6 (manual git history review, not adversarial-reviewer agent)
- **Date:** 2026-03-30T07:20:32Z
- **Method:** Git diff analysis of each commit in sequence, cross-referenced against current code state and test suite

---

## Commit Sequence

| # | Hash | Description | Files | +/- |
|---|------|-------------|-------|-----|
| 1 | `25ce7f8` | feat: shared HTTP transport layer in @pidgeon/core | `core/http.ts`, `core/index.ts` | +196 |
| 2 | `9e83230` | refactor: UPS rate provider uses core HTTP transport | `carrier-ups/rate.ts` | +45/−132 |
| 3 | `682eb9d` | fix(http): Address review findings from HTTP extraction | `core/http.ts` | fix log label, Retry-After date, bodyMessage wiring |
| 4 | `96deac7` | fix(http): extract message from error response bodies (BUG C) | `core/http.ts` | +13 (parseErrorBody message extraction) |
| 5 | `1d1a0dc` | refactor(ups): extract UPS types to dedicated module | `carrier-ups/types.ts` | new file |
| 6 | `9c9b0bf` | refactor(ups): extract token management to auth module | `carrier-ups/auth.ts` | new file |
| 7 | `302d646` | refactor(ups): extract request builder to dedicated module | `carrier-ups/request-builder.ts` | new file |
| 8 | `a9dc34f` | refactor(ups): extract response parser to dedicated module | `carrier-ups/response-parser.ts` | new file |
| 9 | `e2feef3` | fix(ups): map UPS weight unit codes to canonical domain units | `carrier-ups/response-parser.ts` | weight unit fix |

---

## Phase 1: HTTP Layer Extraction (commits 1–2)

### What was extracted

The retry loop, exponential backoff, AbortController timeout, 429 Retry-After handling, and error status classification were lifted from `UpsRateProvider.executeWithToken()` into a standalone `httpRequest()` function in `@pidgeon/core`.

The new function accepts:
- `HttpClientConfig` — fetch function, retry/timeout/backoff knobs, logger
- `HttpRequestConfig` — URL, method, headers, body, carrier name
- `ErrorBodyParser` (optional) — carrier-specific callback to extract error details from response bodies

Returns `CarrierResult<HttpSuccess>` where `HttpSuccess = { status, json }`.

### What stayed carrier-specific

- **Auth retry (401 → invalidate → recurse)** — correctly stayed in `rate.ts` since different carriers may have different auth refresh strategies
- **UPS error envelope parsing** — extracted to `upsErrorBodyParser` callback, passed to `httpRequest()`
- **Request body construction** — UPS-specific payload shape
- **Response mapping** — UPS-specific `RatedShipment` → `RateQuote[]` normalisation

### Bugs introduced during extraction

The initial `25ce7f8` commit copied code incompletely. Three bugs were introduced:

**BUG C — `parseErrorBody` never set `message`**

The old `handleHttpError` in `rate.ts` parsed `response.json()` and directly extracted `errors[].message` from the UPS envelope. When this logic was generalised into `parseErrorBody`, the message extraction was dropped entirely. The function declared `let message: string | null = null`, parsed the JSON into `raw`, but never assigned `message`. All callers passed `null` as `bodyMessage` to `mapStatusToError`.

Impact: Error responses from any status code lost their body detail. A 401 with `{ message: "Token expired" }` would produce `"UPS auth error (401): Unauthorized"` instead of `"UPS auth error (401): Token expired"`.

Fixed in: `96deac7` — added extraction from `{ message }`, `{ error: string }`, and `{ error: { message } }` shapes.

**BUG I — Hardcoded carrier-specific log label**

`logger?.info("rating request", ...)` was copied verbatim from UPS-specific code into the generic HTTP module. Any future carrier using `httpRequest()` would log misleading "rating request" for tracking, label, or address validation calls.

Fixed in: `682eb9d` — changed to `"http request"`.

**BUG B — Retry-After HTTP-date format ignored**

The old code only handled `Retry-After: <seconds>` via `parseInt`. This limitation was carried into the shared module unchanged. Per RFC 7231, `Retry-After` can also be an HTTP-date like `"Sun, 30 Mar 2026 12:00:00 GMT"`. When promoted to a shared module, this gap becomes more significant.

Fixed in: `682eb9d` — added `Date.parse()` fallback when `parseInt` returns NaN.

### How the bugs were caught

The test file `packages/core/src/http.test.ts` was written with explicit labels for each known bug (`BUG B`, `BUG C`, `BUG I` in comments). The tests were written to fail (red) against the buggy code, then the fixes made them green. This is TDD working as designed, but see the atomicity concern below.

---

## Phase 2: UPS Module Decomposition (commits 5–9)

After the HTTP layer was extracted, the remaining `rate.ts` monolith was decomposed into focused modules:

| Module | Responsibility | Lines |
|--------|---------------|-------|
| `types.ts` | `UpsCredentials`, `UpsRateProviderConfig`, `UpsRatedShipment`, `UpsErrorEnvelope`, `upsError()` | ~78 |
| `auth.ts` | `UpsTokenManager` class — token acquisition, caching, invalidation, timeout | ~96 |
| `request-builder.ts` | `buildUpsRateRequest()` — domain → UPS payload mapping | (extracted) |
| `response-parser.ts` | `parseUpsRateResponse()`, `upsErrorBodyParser` — UPS response → domain mapping | ~101 |
| `rate.ts` | `UpsRateProvider` — orchestrator, validation, delegation | ~100 |

**Before:** `rate.ts` was 468 lines handling everything — auth, HTTP, request building, response parsing, error mapping, retry logic.

**After:** `rate.ts` is 100 lines — validates input, gets a token, calls `httpRequest()`, handles auth retry, delegates response parsing.

### Assessment of decomposition

The decomposition follows a clean pattern: each module has a single responsibility, and dependencies flow downward (`rate.ts` → `auth.ts`, `request-builder.ts`, `response-parser.ts`, `types.ts` → `@pidgeon/core`).

The `UpsTokenManager` class is a meaningful improvement over the old inline token cache. Having `invalidate()` as an explicit method is cleaner than the old `this.cachedToken = null` scattered through `executeWithToken`.

---

## What Went Well

1. **All 117 tests stayed green throughout.** The extraction preserved every existing test contract.
2. **Clean extension point.** The `ErrorBodyParser` callback lets each carrier parse its own error envelope without the core HTTP layer knowing carrier-specific shapes.
3. **Correct boundary decisions.** Auth retry stayed carrier-specific. HTTP retry/backoff/timeout went to core. Response parsing stayed carrier-specific.
4. **Good module decomposition.** The final 5-module structure in `carrier-ups` has clear responsibilities and testable boundaries.
5. **Bugs were caught by tests.** The red-green-refactor cycle worked — bugs were surfaced by tests written against the extracted code.

## What Went Wrong

1. **Lossy copy introduced 3 bugs.** The initial extraction dropped message extraction, kept a carrier-specific log label, and missed Retry-After date parsing. These are "copy-paste degradation" — the kind of error that happens when code is moved between contexts without re-examining every line.

2. **Bugs shipped in a "feat" commit.** `25ce7f8` was committed with known deficiencies that required follow-up fixes. The test file's BUG comments suggest the bugs were known at test-writing time. Ideally the feat commit would have been clean, or the fix commits would have been squashed into it before landing on the branch.

3. **Commit message says "spec compliance" but the initial code wasn't compliant.** The commit message for `25ce7f8` claims spec compliance, but the shipped code had a non-functional `parseErrorBody` and a carrier-specific log label — neither of which matches a "shared HTTP transport layer" claim.

---

## Remaining Concerns

These are carried over from the pre-extraction code, not introduced by the refactoring:

### Redundant double timeout (LOW)

`http.ts:132-138` uses `Promise.race` with both the fetch (which has `signal: controller.signal`) and a manual abort listener promise. Both produce AbortError on timeout. Bun's `fetch` handles AbortSignal natively, making the manual abort promise redundant. Not a bug — the catch block handles both paths — but unnecessary complexity in a shared module.

### Token thundering herd (MEDIUM)

`auth.ts:32-36` — no in-flight promise deduplication. Two concurrent `getRates()` calls seeing an expired token will both call `acquireToken()`, making duplicate OAuth requests. The `await` in `acquireToken` yields, allowing interleaving. Standard fix: `this.tokenPromise ??= this.acquireToken().finally(() => { this.tokenPromise = null; })`.

### Unsafe `as` casts on UPS response (MEDIUM)

`response-parser.ts:25-37` casts `json as Record<string, unknown>` and `ratedShipments as UpsRatedShipment[]` without Zod validation. The code has null checks and a try/catch that mitigate, but a malformed UPS response would produce a cryptic TypeError rather than a structured error identifying the missing field. Per CLAUDE.md: "Zod schemas in core, validated at service boundary."

---

## Net Assessment

The refactoring achieves its goal: `rate.ts` went from a 468-line monolith to a 100-line orchestrator backed by focused modules and a shared HTTP layer. The extraction boundary is well-chosen, the extension points are clean, and the test suite covers the contracts.

The bugs introduced during extraction were caught and fixed within the same branch. The main process improvement would be tighter pre-commit review to avoid shipping known-buggy code in "feat" commits — the fix-up pattern creates a noisy git history and risks someone checking out an intermediate commit with broken behaviour.
