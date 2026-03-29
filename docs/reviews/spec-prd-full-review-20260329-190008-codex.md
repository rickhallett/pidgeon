[HIGH] R5 / Types and Validation: there is still no runtime validation at the service boundary before external calls

Where:
- `packages/core/src/index.ts:5`
- `packages/core/src/index.ts:11`
- `packages/carrier-ups/src/config.ts:1`
- `packages/carrier-ups/src/rate.ts:55`
- `spec.md:41`
- `docs/PRD.md:35`

What:
The repo currently uses Zod only for UPS environment config. Core exports plain TypeScript types, but no runtime schemas for `RateRequest`, `Address`, `Package`, `RateQuote`, or errors. `UpsRateProvider.getRates()` accepts a `RateRequest` and immediately proceeds to token acquisition and request dispatch without validating the input.

Why it matters:
Both the spec and PRD require runtime validation schemas for the domain models and explicit validation before any external call. Right now that boundary is only compile-time-deep, so malformed runtime input can cross the service boundary undetected.

Evidence:
A direct probe using `packages/carrier-ups/src/rate.ts` with an invalid runtime request (`packages: []`, blank address fields) still called both the OAuth token endpoint and the rating endpoint and returned `{ ok: true, data: [] }`.

Recommendation:
Define the domain schemas in `@pidgeon/core`, export them alongside the types, and validate `RateRequest` at the provider/CLI boundary before token acquisition or HTTP dispatch.

[HIGH] R5 / R6 / Domain Modeling: the public domain types do not match the spec/PRD contract

Where:
- `packages/core/src/index.ts:11`
- `packages/core/src/index.ts:39`
- `packages/core/src/index.ts:50`
- `spec.md:24`
- `spec.md:45`
- `docs/PRD.md:21`

What:
The public domain model promised in the spec is broader than the one actually exported:
- `Address` omits `street`, despite `spec.md` defining it
- `RateRequest` has no optional service level
- `RateQuote` omits `estimatedDelivery`
- `transitDays` is typed as required `number`, while the spec says `number | null`

Why it matters:
This is the contract consumed by callers and future carriers. At the moment, the implementation and tests may work for the current UPS slice, but the public API does not match the documented normalized model the project says it provides.

Recommendation:
Either align `@pidgeon/core` with the documented contract, or explicitly revise the spec/PRD so the public model matches the actual intended scope.

[HIGH] R6 / Error Handling: provider-boundary errors are still plain strings, not structured carrier errors

Where:
- `packages/core/src/index.ts:5`
- `packages/carrier-ups/src/rate.ts:94`
- `packages/carrier-ups/src/rate.ts:155`
- `packages/carrier-ups/src/rate.ts:163`
- `spec.md:49`
- `spec.md:76`
- `docs/PRD.md:39`

What:
`Result<T>` currently returns `error: string`, and all UPS failure paths map to strings such as `"Request timeout"` or `"UPS auth error (401): ..."`. There is no exported `CarrierError` model, no code/carrier/retriable metadata, and no internal custom error hierarchy as promised by the spec.

Why it matters:
The spec and PRD both call for structured, actionable errors. With the current string-only boundary, callers cannot reliably distinguish retryable rate limiting from auth failures or malformed upstream responses without parsing human text.

Recommendation:
Introduce a structured error type in `@pidgeon/core` and make the provider return that shape at the boundary. Then update tests to assert structured fields instead of message fragments.

[MEDIUM] R2 / Auth implementation: transparent auth refresh is still not invisible to the caller when a cached token is rejected during a rating call

Where:
- `packages/carrier-ups/src/rate.ts:56`
- `packages/carrier-ups/src/rate.ts:153`
- `packages/carrier-ups/src/http-retry.test.ts:306`
- `spec.md:53`
- `docs/PRD.md:23`

What:
The provider caches tokens and refreshes them on expiry before the request, but if the rating endpoint returns `401` for an already-cached token, `getRates()` returns a final auth error after clearing the cache. The next caller gets a fresh token, but the current caller still sees the auth mechanics.

Why it matters:
The PRD requirement is “transparent refresh on expiry.” In practice, token invalidation races and clock skew are exactly where transparency matters. The current tests also codify the non-transparent behavior by asserting that rating `401` is not retried.

Recommendation:
On a rating `401`, invalidate the cached token, reacquire once, and retry the request once before surfacing an auth failure.

[MEDIUM] Deliverables / Configuration: the repo is still missing two explicit PRD deliverables

Where:
- `docs/PRD.md:65`
- `spec.md:61`

What:
There is no root `README.md`, and there is no `.env.example` file in the repository root.

Why it matters:
These are explicitly listed deliverables in the PRD, and `.env.example` is also called out in the spec’s configuration section. Even if the code is otherwise functional, the submission is incomplete against the stated assessment criteria.

Recommendation:
Add a concise `README.md` covering design decisions, run instructions, and follow-up improvements, plus a root `.env.example` listing the required UPS environment variables.
