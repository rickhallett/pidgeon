# Full System Review: Pidgeon Carrier Integration Service
Date: 2026-03-29 20:28:38

## Compliance Summary (Spec & PRD Analysis)

| Requirement | Status | Observations |
| :--- | :--- | :--- |
| **Monorepo Structure** | OK | Bun workspaces correctly segregate `@pidgeon/core` and `@pidgeon/carrier-ups`. |
| **Carrier Abstraction** | OK | Hybrid strategy pattern used; factory pattern in place for provider lookup. |
| **Rate Normalization** | Partial | Brittle object access; nested property chain risks `TypeError`. |
| **Auth Flow** | High Risk | Missing concurrency controls (mutex/debouncing) for token fetching; in-memory cache vulnerable to drift. |
| **Configuration** | Partial | Logic-level fallbacks conflict with Zod schemas; single-source-of-truth violated. |
| **Types & Validation** | Partial | CLI uses `Number()` constructor (unsafe) instead of Zod parsing; boundary objects are well-typed. |
| **Error Handling** | CRITICAL | Partial failure masking in `getRatesFromAll`; inconsistent HTTP error shape handling. |
| **HTTP Layer** | Partial | Incomplete 4xx handling (non-transient errors not filtered/managed). |
| **CLI** | OK | Commander-based subcommands established. |
| **Testing** | Good | Coverage of error/retry paths is robust, though mocks are high-maintenance due to tight coupling. |

## Adversarial Findings

### 1. Resilience (CRITICAL)
- **Finding:** `getRatesFromAll` silently suppresses errors from individual providers.
- **Spec Mandate:** "Errors returned to the caller should be meaningful and structured."
- **Failure:** Errors from individual carriers are effectively lost if one succeeds.

### 2. Type Safety (HIGH)
- **Finding:** `cli.ts` uses raw `Number()` casting.
- **Spec Mandate:** "Validate input before making any external call."
- **Failure:** Unvalidated numeric input can trigger invalid domain behavior.

### 3. Architecture Integrity (MEDIUM)
- **Finding:** Hardcoded fallbacks in `rate.ts` bypass Zod defaults.
- **Spec Mandate:** "Single config module."
- **Failure:** Logic is decoupled from the validated schema state.

### 4. HTTP Resilience (MEDIUM)
- **Finding:** 4xx handling is monolithic.
- **Spec Mandate:** "Handle realistic failure modes... differentiate error codes."
- **Failure:** Permanent (400, 403) vs transient (429) errors are insufficiently distinguished at the boundary.

### 5. Testing Methodology (LOW)
- **Finding:** Mocks rely on deep-nesting structure.
- **Spec Mandate:** "Tests verify: ...successful responses are parsed and normalized."
- **Failure:** Tests are coupled to the UPS API schema version rather than the Pidgeon normalization contract, creating maintenance debt.
