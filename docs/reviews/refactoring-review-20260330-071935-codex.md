# Refactoring Review

**Scope:** current `main` working tree on 2026-03-30, focused on the UPS/provider refactor and extracted core HTTP transport
**Date:** 2026-03-30T07:19:35Z
**Model:** codex
**Method:** targeted review of `packages/core/src/http.ts`, `packages/carrier-ups/src/rate.ts`, extracted UPS helper modules, and fresh test runs of `bun test packages/core/src/http.test.ts` and `bun test packages/carrier-ups/src/http-retry.test.ts`

---

[MEDIUM] Correctness — Unknown UPS weight codes silently become pounds

  Where: `packages/carrier-ups/src/response-parser.ts:11`
  What: `parseUpsWeightUnit()` falls back to `"lb"` for any unrecognized UPS unit code instead of rejecting the response.
  Why it matters: this creates a silent wrong-answer mode. If UPS returns a new or unexpected unit code, the parser will emit a valid-looking quote with the wrong billable-weight unit rather than surfacing a provider error that forces investigation.
  Evidence: `return UPS_WEIGHT_TO_CANONICAL[upsCode] ?? "lb";` in `packages/carrier-ups/src/response-parser.ts`.
  Suggested fix: fail closed for unknown weight-unit codes, or preserve the raw code in a type that requires explicit handling by the caller.

[MEDIUM] Correctness — Shared timeout retries can still overlap an uncancelled in-flight request

  Where: `packages/core/src/http.ts:119`
  What: `httpRequest()` still uses `Promise.race()` between `fetch()` and an abort-driven rejection. If the supplied `FetchFn` does not actually cancel work when the signal aborts, the timeout path retries even though the original request may still complete.
  Why it matters: this refactor moved the behavior into the shared transport layer, increasing the blast radius from a single UPS rate call to any future operation that reuses `httpRequest()`. That becomes especially risky for non-idempotent requests.
  Evidence: the timeout path races `config.fetch(...)` with a separate abort promise in `packages/core/src/http.ts`, and retries on `AbortError` without proving the underlying request was cancelled.
  Suggested fix: make timeout retries conditional on confirmed cancellation semantics, or restrict retry behavior to explicitly idempotent operations.

## Assessment

The refactor is a net improvement. Splitting UPS auth, request building, response parsing, and provider orchestration makes the package materially easier to navigate than the previous single-file implementation. The remaining risks are mostly at the extracted boundaries: one silent data-normalization default in the UPS parser, and one transport-level retry behavior that is still too optimistic about cancellation.

## Verification

- `bun test packages/core/src/http.test.ts` -> 36 pass, 0 fail
- `bun test packages/carrier-ups/src/http-retry.test.ts` -> 13 pass, 0 fail
