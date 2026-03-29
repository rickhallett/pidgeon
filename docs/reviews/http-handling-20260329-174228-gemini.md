[MEDIUM] Resilience — Incomplete HTTP Error Handling
  Where: packages/carrier-ups/src/rate.ts:L65-L87
  What: The retry loop handles 429 and 500+ status codes, but 401/403/404/422 status codes are either not retried or implicitly handled by `handleHttpError`.
  Why it matters: While 5xx errors are retryable, 4xx errors (excluding 429) usually represent permanent failures (auth, bad request) that should stop retrying immediately. The current structure is clean but could be more explicit in categorizing permanent vs. transient errors.
  Evidence: `if (status >= 500) { ... continue; }`
  Suggested fix: Explicitly define `isTransientError(status: number)` and `isPermanentError(status: number)` to clarify the retry strategy.

[LOW] Reliability — `AbortController` usage
  Where: packages/carrier-ups/src/rate.ts:L39, L45
  What: The `AbortController` and timeout are initialized inside the loop.
  Why it matters: This is correct, but the manual `AbortController` integration with `Promise.race` is slightly verbose.
  Evidence: `const controller = new AbortController(); ... Promise.race([...])`
  Suggested fix: Native fetch (depending on environment/node version) often supports `signal` with a timeout natively (e.g., `AbortSignal.timeout(ms)`), which simplifies this code significantly.

[LOW] Consistency — Error message normalization
  Where: packages/carrier-ups/src/rate.ts:L117-L119
  What: Errors originating from `handleHttpError` (UPS-specific JSON) are handled separately from network errors (generic `network error: ...`).
  Why it matters: Callers of `getRates` receive inconsistent error shapes (e.g., "UPS error: ...: ..." vs "network error: ...").
  Evidence: `lastResult = { ok: false, error: "network error: ..." }` vs `return { ok: false, error: "UPS error (...): ..." }`
  Suggested fix: Map all internal failures to a standardized set of `CoreError` types (e.g., `AuthenticationError`, `NetworkError`, `RateError`) to improve downstream reliability.
