[MEDIUM] Security — Insecure token cache expiration check
  Where: packages/carrier-ups/src/rate.ts:154
  What: `Date.now() < this.cachedToken.expiresAt` is used to validate token freshness.
  Why it matters: If the system clock is skewed or if the token is revoked server-side, this cache logic provides no mechanism to re-acquire. Furthermore, it doesn't account for "clock drift" (the difference between local time and UPS server time).
  Evidence: `if (this.cachedToken && Date.now() < this.cachedToken.expiresAt)`
  Suggested fix: Implement a buffer (e.g., consider the token expired 60 seconds *before* the actual expiry time) to account for clock skew and transient network issues.

[MEDIUM] Reliability — Implicit dependency on OAuth token response structure
  Where: packages/carrier-ups/src/rate.ts:189-191
  What: The code manually checks for `access_token` and `token_type` (implicitly) in the raw JSON response without a defined schema.
  Why it matters: The UPS OAuth response may contain other useful fields (e.g., `scope`, `issued_at`) that are ignored, and if the API evolves to include nested objects, manual parsing becomes brittle.
  Evidence: `const accessToken = body?.access_token;`
  Suggested fix: Create a Zod schema for the OAuth Token response to ensure the entire expected shape is validated before usage.

[LOW] Reliability — Lack of token refresh protection (Debouncing)
  Where: packages/carrier-ups/src/rate.ts
  What: `getRates` calls `getToken` which calls `acquireToken`.
  Why it matters: If multiple `getRates` requests are fired simultaneously while the token is expired/missing, they will all independently trigger `acquireToken` calls, leading to a "thundering herd" of OAuth token requests.
  Evidence: No locking or queueing mechanism around `acquireToken`.
  Suggested fix: Wrap `acquireToken` in a promise-based mutex or use a simple flag to ensure only one token acquisition request is in flight at a time.
