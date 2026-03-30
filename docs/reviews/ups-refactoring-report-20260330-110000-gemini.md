# Report: UPS Rate Provider Refactoring Review

## Metadata
- **Date**: 2026-03-30
- **Reviewer**: Gemini
- **Scope**: `packages/carrier-ups/src/rate.ts`
- **Focus**: Refactoring impact, Maintainability, Architectural Alignment

## Executive Summary
The recent refactoring of the `UpsRateProvider` has successfully transformed a monolithic, ~468-line source file into a clean, decoupled architecture of ~80 lines. By delegating concerns—authentication to `UpsTokenManager`, request mapping to `buildUpsRateRequest`, and response normalization to `parseUpsRateResponse`—the codebase is significantly more maintainable and aligned with the `pidgeon/core` design patterns.

## Key Improvements
1.  **Decomposition**: Logic is cleanly separated into specialized modules, enhancing readability and testability.
2.  **Centralized Transport**: The migration to `@pidgeon/core`'s `httpRequest` utility standardizes HTTP concerns (retries, backoff, logging, timeouts) across the carrier ecosystem.
3.  **Error Handling**: Implementation of the Result pattern with a discriminated union ensures robust, type-safe error propagation and handling.
4.  **Resiliency**: A strong 401 retry mechanism is now in place, providing an automated fallback for expired credentials.

## Findings & Actionable Recommendations

### 1. Refactor Token Management to Shared Transport
- **Current State**: `UpsTokenManager` currently implements its own custom fetch logic for token acquisition.
- **Recommendation**: Integrate the shared `httpRequest` utility into `UpsTokenManager`. This would unify the carrier provider's transport layer, granting it immediate access to existing retry, backoff, and logging infrastructure while reducing code duplication.

### 2. Improve HTTP `Retry-After` Compliance
- **Current State**: `core/http.ts` currently parses `Retry-After` as delta-seconds only.
- **Recommendation**: Extend the `httpRequest` utility to handle RFC 7231 HTTP-date formats for the `Retry-After` header. This ensures compatibility with a wider range of server implementations and prevents potentially aggressive retry attempts.

### 3. Mitigate Token Drift
- **Current State**: Expiry calculations depend on local `Date.now()`.
- **Recommendation**: To increase robustness against clock drift between the client and server, consider implementing a "clock skew" buffer or, where possible, deriving expiry offsets from the server's `Date` header in previous responses rather than strictly local time.

## Conclusion
The refactored `UpsRateProvider` represents a significant leap in architectural health. Prioritizing the alignment of the `UpsTokenManager` with the core transport layer and extending HTTP compliance in `core/http.ts` will further harden this service for production reliability.
