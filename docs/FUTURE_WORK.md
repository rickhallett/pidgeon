# Future Work

Known gaps, deferred decisions, and improvement opportunities.
Consolidated from cross-family adversarial reviews (Gemini, Claude, Codex),
spec compliance analysis, and commit history audit.

Items are grouped by theme. Priority reflects consensus across reviewers.

---

## Architecture

### ~~Extract HTTP transport to @pidgeon/core~~ DONE
Extracted to `packages/core/src/http.ts`. UPS provider refactored to use it.

### Config defaults duplication
**Priority:** LOW

Zod schema defaults in `config.ts` and constructor fallbacks in `rate.ts` are
identical but independently maintained. A mismatch would cause different behavior
between "loaded from env" and "constructed directly." No compile-time guard.

**See:** devlog D021

---

## Domain Model

### Additional carrier operations
**Priority:** LOW (placeholder signatures exist)

`CarrierProvider` now has optional `createLabel?()`, `validateAddress?()`, and
`getTracking?()` method signatures. These use `unknown` for request/response types
that will be refined when the first implementation is built.

### Zod schema for RateQuote (output validation)
**Priority:** LOW

Domain input types (`Address`, `Package`, `RateRequest`) have Zod schemas validated
at service boundaries. Output types (`RateQuote`, `Surcharge`) do not. Output
validation would catch mapping bugs at the boundary rather than letting malformed
quotes propagate to callers. Worth adding when a second carrier makes mapping bugs
more likely.

---

## Error Handling

### Internal error classes vs. discriminated union
**Priority:** NONE (deliberate divergence)

The spec prescribes a class hierarchy (`CarrierAuthError extends CarrierError`).
The implementation uses a discriminated union with `CarrierErrorCode`. This is a
deliberate TypeScript idiom choice documented in devlog D019. The union provides
exhaustiveness checking, survives serialization, and composes with `Result<T>`.
Not a gap — a design decision.

---

## Operational Readiness

### Concrete logger implementation
**Priority:** MEDIUM (before production deployment)

A `Logger` interface is defined and wired into the UPS provider with structured
log points (token lifecycle, request dispatch, retry decisions, payloads at debug
level). No concrete logger exists. Before production, inject a real logger
(e.g., pino, console-based, or structured JSON to stdout).

### Redis-backed token cache
**Priority:** LOW (single-instance is fine for now)

In-memory token cache works for single-instance deployments. Multi-instance
(load-balanced) deployments would benefit from a shared Redis cache to avoid
redundant token acquisitions across instances.

**See:** devlog D007 (original), spec Section 4

### Proactive rate limiting
**Priority:** LOW

Current rate limiting is reactive (respects 429 + Retry-After). Proactive
client-side rate limiting (token bucket or sliding window) would prevent hitting
carrier rate limits in the first place. Useful at scale.

---

## Testing

### Inject mock delay for retry/timeout tests
**Priority:** LOW

The timeout retry test runs ~14s of wall-clock time (4 attempts x 3s real
timeouts). Injecting a mock delay function would make these tests instant and
deterministic.

**See:** devlog D012

### Commit history TDD gaps
**Priority:** NONE (historical, non-rewritable)

Three of eleven build steps (walking skeleton, OAuth lifecycle, HTTP retry)
bundled red and green phases in a single commit. No git evidence of the red
phase exists for these steps. Future work should enforce separate test-first
commits, especially for foundational code.

---

## Refactoring Follow-ups

Findings from cross-family reviews of the architecture-maintainability refactoring
(Claude, Codex, Gemini — 2026-03-30). These items were not in scope for the
refactoring but were surfaced by reviewers.

### Token thundering herd
**Priority:** MEDIUM

`UpsTokenManager.getToken()` has no in-flight promise deduplication. Two concurrent
`getRates()` calls seeing an expired token will both call `acquireToken()`, making
duplicate OAuth requests. Standard fix: store the in-flight promise and reuse it.

**Source:** Claude refactoring review

### Unsafe type casts on UPS response
**Priority:** MEDIUM

`response-parser.ts` casts `json as Record<string, unknown>` and
`ratedShipments as UpsRatedShipment[]` without Zod validation. Runtime null checks
and try/catch mitigate, but a malformed UPS response produces a cryptic TypeError
rather than a structured error identifying the missing field.

**Source:** Claude refactoring review

### Token management should use shared httpRequest
**Priority:** MEDIUM

`UpsTokenManager` implements its own fetch logic for token acquisition instead of
using the shared `httpRequest()` from `@pidgeon/core`. Integrating it would unify
retry, backoff, and logging for the token endpoint.

**Source:** Gemini refactoring review

### Unknown UPS weight codes silently become pounds
**Priority:** MEDIUM

`parseUpsWeightUnit()` in `response-parser.ts` defaults unrecognized UPS weight
unit codes to `"lb"`. A code like `"GMS"` would silently map to pounds. Should
either reject with a structured error or log a warning.

**Source:** Codex refactoring review

### Token expiry clock drift
**Priority:** LOW

Token expiry is calculated from local `Date.now()`. Clock skew between client and
UPS server could cause premature or late token refresh. Mitigated by the existing
`tokenExpiryBufferSeconds` (default 60s) and 401 retry logic, but not fully addressed.

**Source:** Gemini refactoring review

---

## Carriers

### FedEx, USPS, DHL
**Priority:** deferred (out of scope for current build)

The `CarrierRegistry` supports multi-carrier aggregation. Adding a carrier means:
1. Create `packages/carrier-{name}/`
2. Implement `CarrierProvider.getRates()`
3. Register with the registry

No changes to existing code required.

---

## Polish

### Retry-After HTTP-date parsing
**Priority:** LOW

Only integer seconds are parsed. HTTP-date format (`Thu, 01 Dec 2025 16:00:00 GMT`)
is technically valid per RFC 7231 but not observed from UPS in practice.

**See:** devlog D001

### Retry policy for corrupt 200 response bodies
**Priority:** LOW

A valid HTTP 200 with an unparseable body returns an immediate error. Retrying
might recover from transient upstream corruption but is not clearly correct
without evidence that UPS sends intermittent corrupt bodies.

**See:** devlog D005
