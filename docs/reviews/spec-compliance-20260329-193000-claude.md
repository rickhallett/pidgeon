# Full System Review: Pidgeon Carrier Integration Service
Date: 2026-03-29 19:24:47

## Compliance Summary

| Requirement | Status | Observations |
| :--- | :--- | :--- |
| **R1 (Rate Shopping)** | **Partial** | Normalization exists, but relies on brittle, deeply nested object access patterns. |
| **R2 (Authentication)** | **High Risk** | In-memory cache implemented, but lacks mutex/debouncing (thundering herd), and cache key relies on env vars without validation. |
| **R3 (Extensibility)** | **Good** | Registry pattern successfully implemented for carrier abstraction. |
| **R4 (Configuration)** | **Partial** | Uses Zod for validation, but manual fallbacks in business logic bypass schema integrity. |
| **R5 (Types/Validation)** | **Partial** | Input validation implemented via Zod, but CLI inputs use `Number()` casting (bypassing Zod). |
| **R6 (Error Handling)** | **High Risk** | `getRatesFromAll` silences partial failures; HTTP error layer inconsistent. |
| **R7 (Integration Tests)**| **Good** | Solid coverage of error paths, but mocks are brittle/over-coupled to implementation details. |

## Detailed Findings (Updated)

### 1. Resilience & Error Handling (CRITICAL)
- **Finding:** `getRatesFromAll` silently suppresses errors from providers if other providers succeed.
- **Impact:** Multi-carrier integration loses visibility into sub-system health.
- **Reference:** `packages/core/src/registry.ts`

### 2. Validation & Type Safety (HIGH)
- **Finding:** CLI module uses raw `Number()` casting for numeric CLI arguments.
- **Impact:** `NaN` or unvalidated input can propagate into the domain layer, causing unexpected runtime behavior.
- **Reference:** `packages/core/src/cli.ts`

### 3. Architecture & Config Integrity (MEDIUM)
- **Finding:** Implementation logic contains hardcoded `??` fallbacks that conflict with Zod schema defaults.
- **Impact:** Breaks the "Single config module" mandate and makes configuration state opaque.
- **Reference:** `packages/carrier-ups/src/rate.ts`, `config.ts`

### 4. HTTP Layer (MEDIUM)
- **Finding:** 4xx handling treats all 4xx (except 429) as generic errors.
- **Impact:** Permanent errors (e.g., Auth, Bad Request) are not distinguished from transient ones, complicating retries.
- **Reference:** `packages/carrier-ups/src/rate.ts`

### 5. Testing Methodology (LOW)
- **Finding:** Tests are over-coupled to implementation details (nested structure assertions) rather than behavior.
- **Impact:** Refactoring of normalization logic will inevitably break these tests, despite potentially correct behavior.
- **Reference:** `packages/carrier-ups/src/response-normalization.test.ts`
