# Review: UPS Rate Provider HTTP Extraction

## Metadata
- **Date**: 2026-03-30
- **Reviewer**: Gemini
- **Scope**: `packages/carrier-ups/src/rate.ts`
- **Focus**: Security and Correctness of HTTP/Auth flow

## Executive Summary
The implementation of the `UpsRateProvider` is functionally sound and follows the established `pidgeon/core` patterns. No critical security vulnerabilities were identified in the request or authentication lifecycle. The use of `btoa` for Basic auth and `Bearer` tokens for the rating endpoint is consistent with the UPS API specification.

## Findings

### Security Review
- **Confidence**: High
- **Result**: No high-confidence vulnerabilities identified in the provided implementation.

### Implementation Observations & Risks

#### [RISK-001] Token Expiry Logic (Medium)
- **What**: The current expiry calculation `expiresAt: Date.now() + Math.max(0, expiresIn - this.tokenExpiryBufferSeconds) * 1000` is based on the local time of token acquisition.
- **Why it matters**: If a request sequence spans the expiry time, or if the server and client clocks are significantly out of sync, the provider might attempt to use an expired token.
- **Current Mitigation**: The `executeWithToken` method includes a `!isAuthRetry` check which clears the cache and attempts a single retry on a 401 error. This is a robust fallback for transient auth failures.

#### [OBS-001] Error Body Parsing
- **What**: The `upsErrorBodyParser` correctly handles the UPS error envelope, mapping multiple errors into a single string.
- **Why it matters**: This ensures that when the HTTP client receives a 4xx/5xx response, the caller gets a meaningful error message rather than a generic HTTP status code.

#### [OBS-002] AbortController & Timeouts
- **What**: The `httpRequest` from `@pidgeon/core` utilizes an `AbortController` and `Promise.race` for timeouts, and `UpsRateProvider` exposes these through `RetryConfig`.
- **Why it matters**: This prevents hanging requests, which is crucial for a production rating service.

## Recommendations
- **No immediate action required.** The current implementation is secure and aligns with the project's architectural standards.
- Monitor `devlog.yml` for any production auth errors that exceed the current single-retry threshold.
