# Adversarial Review — Auth Lifecycle (OAuth Integration)

**Scope:** Uncommitted changes on `feature/ups-auth-lifecycle` (token acquisition, caching, refresh, error paths)
**Date:** 2026-03-29T17:02:37Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 1 CRITICAL, 2 HIGH, 4 MEDIUM, 2 LOW

---

## Previous Review Status

### From `request-builder-20260329-162939-claude.md`:

| Finding | Severity | Status |
|---------|----------|--------|
| mapResponse uncaught TypeError on missing Service/nested fields | HIGH | **RESOLVED** — try/catch block at lines 99-147 wraps the entire quote-building loop |
| URL change without walking skeleton awareness | HIGH | **OPEN** — rate.test.ts still does not assert the request URL |
| Missing AddressLine in request payload | MEDIUM | **OPEN** — mapAddress still omits AddressLine; core Address type unchanged |
| Weak TimeInTransit toBeDefined() assertion | MEDIUM | **RESOLVED** — now uses `toContain("TimeInTransit")` |
| capturingFetch JSON.parse safety | MEDIUM | **RESOLVED** — try/catch around JSON.parse |
| `as any` in tests | LOW | **RESOLVED** — request-builder.test.ts uses `UpsRateRequestPayload` type |
| Dead UpsRateResponseEnvelope | LOW | **RESOLVED** — removed in triage round-3 |
| Unit mapping fallback | LOW | **OPEN** — mapWeightUnit/mapDimensionUnit still silently uppercase unknown units |

### Carried from earlier reviews:

| Finding | Status |
|---------|--------|
| GuaranteedIndicator logic | **OPEN** — no test covers the guaranteed=true case |
| Empty barrel export | **OPEN** |
| Spec/type divergence (estimatedDelivery) | **OPEN** |
| Retry-After untested | **OPEN** — BUILD_ORDER step 8 |

### Gemini review (oauth-integration-20260329-165931-gemini.md):

| Finding | Severity | Verdict |
|---------|----------|---------|
| No expiry buffer for clock skew | MEDIUM | **VALID** — see MEDIUM #1 below; amplified by CRITICAL |
| No Zod schema for token response | MEDIUM | **VALID but LOW priority** — manual access_token check is functional; defer Zod to BUILD_ORDER step 4/9 |
| Thundering herd on concurrent requests | LOW | **VALID** — upgraded to MEDIUM below due to interaction with expires_in fallback |

---

## CRITICAL

### [CRITICAL] SECURITY — Stale cached token is never invalidated on 401 from rating endpoint

```
Where: packages/carrier-ups/src/rate.ts:45-46, 59-83, 153-157
What: When the rating endpoint returns HTTP 401 ("Invalid Access Token"),
      handleHttpError returns a Result error, but cachedToken is never
      cleared. The only write to this.cachedToken is in acquireToken()
      (line 195). There is no code path that sets it to null after
      construction.

      If a token is revoked server-side before its expires_in elapses,
      every subsequent getRates() call reuses the revoked token from cache
      (because Date.now() < expiresAt still holds), and every call fails
      with the same 401 until expiresAt is reached.

Why it matters: A single server-side token revocation causes a complete
      outage of the rate provider for up to 4 hours (typical UPS
      expires_in of 14399 seconds). The caller cannot recover short of
      constructing a new UpsRateProvider instance.

Evidence: Grep for "cachedToken" — only two assignments:
        line 18: initialization to null
        line 195: set in acquireToken()
      No invalidation on error. No test covers "401 from rating endpoint
      triggers token re-acquisition on next call."

Suggested fix: On 401 from the rating endpoint, set this.cachedToken = null
      before returning the error. Optionally retry once with a fresh token.
      Add test: get a valid token, then have rating endpoint return 401,
      then verify next getRates() call triggers new token acquisition.
```

---

## HIGH

### [HIGH] TEST QUALITY — "non-JSON token response" test does not exercise the JSON parse failure path

```
Where: packages/carrier-ups/src/auth.test.ts:222-242
What: The test is named "returns error when token endpoint returns non-JSON"
      but sends HTTP 502 with an HTML body. The acquireToken() method checks
      !response.ok (line 177) BEFORE attempting response.json() (line 183).
      A 502 is not ok, so the code returns "UPS auth token error (502)"
      and never reaches the JSON parse try/catch.

      The JSON parse failure path (lines 182-185) is therefore untested.
      To reach it, the response must have status 200 with a non-JSON body.

Why it matters: The test claims to cover a code path it does not exercise.
      If the JSON parse error message on line 185 were changed or deleted,
      no test would break. This is "Right Answer, Wrong Work" from CLAUDE.md.

Evidence:
      auth.test.ts:225: status 502 + HTML body
      rate.ts:177: if (!response.ok) return — exits before JSON parse
      rate.ts:182-185: JSON parse try/catch — unreachable in this test

Suggested fix: Change the test to return HTTP 200 with a non-JSON body
      (e.g., plain text). This forces past the !response.ok check and
      into the JSON parse path.
```

### [HIGH] SECURITY — btoa with non-ASCII credentials is non-compliant with RFC 6749

```
Where: packages/carrier-ups/src/rate.ts:168
What: btoa(`${clientId}:${clientSecret}`) will throw if clientId or
      clientSecret contain characters outside the Latin1 range (code
      points > 255). Even within Latin1, if credentials contain a colon,
      the server-side split on ":" misparses the boundaries.

      RFC 6749 Section 2.3.1 requires percent-encoding of client_id and
      client_secret before base64-encoding.

      UPS credentials are typically ASCII alphanumeric, so this is unlikely
      to trigger today. But the btoa throw is caught by the outer
      try/catch and misclassified as a generic "token endpoint error."

Why it matters: Non-compliant encoding causes opaque auth failures.
      A thrown exception from btoa is caught but misclassified.

Evidence: rate.ts:168: btoa(`${clientId}:${clientSecret}`)
      RFC 6749 2.3.1: "encoded using the application/x-www-form-urlencoded
      encoding algorithm"

Suggested fix: Use RFC-compliant encoding:
      btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`)
      Or add a runtime assertion that credentials are ASCII-only.
```

---

## MEDIUM

### [MEDIUM] CORRECTNESS — No expiry buffer for clock skew

```
Where: packages/carrier-ups/src/rate.ts:154, 197
What: Token freshness is Date.now() < expiresAt, with expiresAt computed
      as Date.now() + expires_in * 1000 at receipt time. Network latency
      means the token was issued seconds before the local timestamp.
      A 30-60 second buffer is standard practice.

Why it matters: Intermittent 401s near token expiry. Combined with the
      CRITICAL (no cache invalidation), this cascades into sustained outage.

Evidence: Gemini review finding 1 (validated).

Suggested fix: expiresAt: Date.now() + (expiresIn - 60) * 1000
      Clamp to 0 if expires_in < 60.
```

### [MEDIUM] CORRECTNESS — expires_in fallback to 0 if field is a string

```
Where: packages/carrier-ups/src/rate.ts:194
What: typeof body.expires_in === "number" ? body.expires_in : 0

      If UPS returns expires_in as a string (e.g., "14399" — consistent
      with their pattern of string numerics in the Rating API), the typeof
      check fails, expiresIn becomes 0, and the token is immediately
      expired. Every getRates() call triggers a fresh token acquisition.

Why it matters: Silent performance degradation. Could trigger UPS rate
      limiting on the token endpoint. No test verifies string expires_in.

Evidence: rate.ts:194; docs/ups-api-reference.md:274 ("All numeric values
      in responses are strings" — Rating API; OAuth may differ but
      unconfirmed).

Suggested fix: Parse flexibly:
      const raw = body.expires_in;
      const expiresIn = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      Add test with expires_in as string.
```

### [MEDIUM] TEST QUALITY — Token refresh test is timing-sensitive and incomplete

```
Where: packages/carrier-ups/src/auth.test.ts:180-202
What: Creates a 1-second token and awaits setTimeout(1200ms). This adds
      1.2 seconds to every test run and is CI-flaky. More importantly,
      the same token response is returned for both acquisitions — the test
      does not verify the second token is actually different or that the
      second token is used in the Bearer header.

Why it matters: Flaky on slow CI. Does not verify the fresh token is
      actually used (only checks token call count).

Evidence: auth.test.ts:189 — same tokenResponse for both calls
      auth.test.ts:201 — only checks tokenCalls().toHaveLength(2)

Suggested fix: Return different access_tokens per call (counter in fake
      fetch). Verify Bearer header on second rating request uses new token.
      Consider mock clock instead of real setTimeout.
```

### [MEDIUM] CORRECTNESS — Thundering herd on concurrent expired-token requests

```
Where: packages/carrier-ups/src/rate.ts:153-158
What: If three concurrent getRates() calls arrive when the token is
      expired, all three independently call acquireToken() because
      async interleaving means each enters getToken() before any
      acquireToken() resolves.

Why it matters: Unnecessary load on UPS token endpoint. Combined with
      the expires_in=0 fallback, every call could trigger a token request.

Evidence: No mutex/promise deduplication around acquireToken.
      Gemini review finding 3 (validated, upgraded from LOW to MEDIUM).

Suggested fix: Store in-flight acquireToken() promise:
      private pendingToken: Promise<Result<string>> | null = null;
      Return it to concurrent callers instead of starting new acquisitions.
```

---

## LOW

### [LOW] API CONTRACT — Token URL is hardcoded to production; no CIE/testing support

```
Where: packages/carrier-ups/src/rate.ts:165, 30
What: Token URL hardcoded to onlinetools.ups.com (production). The UPS
      CIE (testing) URL is wwwcie.ups.com. No configuration option to
      switch environments.

Evidence: rate.ts:165 vs docs/ups-api-reference.md:18

Suggested fix: Accept baseUrl in config (defaulting to production) and
      construct both token and rating URLs from it.
```

### [LOW] TEST QUALITY — withAuth wrapper in rate-errors.test.ts hides token-related network errors

```
Where: packages/carrier-ups/src/rate-errors.test.ts:53-63
What: The withAuth() wrapper intercepts any URL containing "/oauth/token"
      and returns success. Error path tests only test network errors on
      the RATING endpoint. Token endpoint failures during rating flows
      are covered only in auth.test.ts, with no cross-reference.

Why it matters: Low risk but creates a testing blind spot where token
      endpoint failures during error scenarios are invisible.

Suggested fix: Add a comment documenting that auth error paths are in
      auth.test.ts, not rate-errors.test.ts.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 1 | Stale token never invalidated on rating 401 — up to 4-hour outage |
| HIGH | 2 | Non-JSON test covers wrong path (Right Answer, Wrong Work); btoa RFC non-compliance |
| MEDIUM | 4 | No expiry buffer; string expires_in breaks caching; timing-sensitive test; thundering herd |
| LOW | 2 | Hardcoded production URLs; withAuth wrapper blind spot |

## Trend

The auth integration is structurally sound — token flow works, errors are caught and wrapped in Result, and the test suite covers the main paths. The CRITICAL (no cache invalidation on rating 401) is the most consequential: it turns a transient auth failure into a sustained outage. The HIGH findings are both "looks correct, tests something different than claimed" problems.

All three Gemini findings were validated. The clock-skew and thundering-herd issues are amplified by the expires_in string fallback: if UPS returns expires_in as a string, the cache becomes a no-op and every call hammers the token endpoint.

The previous round's biggest gap (uncaught TypeError in mapResponse) is resolved by the try/catch added in the triage round. Five earlier findings remain open (AddressLine, GuaranteedIndicator, barrel export, spec divergence, Retry-After).
