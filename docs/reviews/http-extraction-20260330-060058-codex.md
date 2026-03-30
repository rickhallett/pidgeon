# HTTP Extraction Review

**Scope:** committed changes through `0ae8f4a6f7881df6877ea8c4cde8f72f94aaf3f9`, focused on `25ce7f8` and `9e83230`
**Date:** 2026-03-30T06:00:58Z
**Model:** codex
**Method:** targeted `git diff main...HEAD`, side-by-side comparison against pre-extraction UPS HTTP logic, and fresh test runs of `bun test packages/carrier-ups/src/auth.test.ts`, `bun test packages/carrier-ups/src/http-retry.test.ts`, and `bun test packages/carrier-ups/src/rate-errors.test.ts`

---

[HIGH] Correctness — Timeout retries can duplicate a request if the injected `fetch` ignores `AbortSignal`

  Where: `packages/core/src/http.ts:106`
  What: `httpRequest()` races `config.fetch(...)` against a separate promise that rejects on `controller.abort()`. If the supplied `FetchFn` does not actually cancel work when the signal aborts, the timeout path treats the call as failed and immediately retries while the original request is still in flight.
  Why it matters: this shared transport is now exported from core and accepts arbitrary HTTP methods. For non-idempotent future uses such as label purchase or shipment creation, a slow first request can still succeed server-side while the client issues a second POST, creating duplicate side effects.
  Evidence: the timeout path is driven by `Promise.race([... abort promise ...])` in `packages/core/src/http.ts`, and the retry loop continues on `AbortError` instead of proving that the original request was cancelled.
  Suggested fix: do not synthesize timeout failure independently of the transport's cancellation semantics for retryable requests. Either rely on a fetch implementation that rejects on abort, or make retries conditional on confirmed cancellation or request idempotency.

[MEDIUM] API Contract — `Retry-After` parsing rejects a valid HTTP-date form and falls back to an earlier retry than the server asked for

  Where: `packages/core/src/http.ts:148`
  What: the extracted layer only parses `Retry-After` with `parseInt()`, which handles integer seconds but not the other valid HTTP form: an absolute HTTP date.
  Why it matters: on a compliant `429` response like `Retry-After: Wed, 31 Mar 2026 12:00:00 GMT`, this code treats the header as unusable and retries using exponential backoff instead of the server-mandated delay. That can keep the client throttled and turn a recoverable rate limit into repeated failures.
  Evidence: `const seconds = parseInt(retryAfter, 10)` is the only parsing logic in `packages/core/src/http.ts`, and the retry tests only cover `"1"`-style headers in `packages/carrier-ups/src/http-retry.test.ts`.
  Suggested fix: support both delta-seconds and HTTP-date `Retry-After` values, then clamp the computed delay against `maxRetryAfterSeconds`.

## Verification

- `bun test packages/carrier-ups/src/auth.test.ts` -> 11 pass, 0 fail
- `bun test packages/carrier-ups/src/http-retry.test.ts` -> 13 pass, 0 fail
- `bun test packages/carrier-ups/src/rate-errors.test.ts` -> 16 pass, 0 fail
