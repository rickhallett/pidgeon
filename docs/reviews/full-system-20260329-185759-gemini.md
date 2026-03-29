[HIGH] Resilience — Partial Failure Visibility (Ref: Registry)
  Where: `packages/core/src/registry.ts`
  What: `getRatesFromAll` silences failures of individual carriers if at least one carrier succeeds.
  Why it matters: Spec states Pidgeon is for "multi-carrier shipping integration". Masking a carrier failure in a multi-carrier system hides data from the comparison engine.
  Status: Non-compliant with multi-carrier reliability expectations.

[HIGH] Resilience — HTTP error boundary (Ref: HTTP Layer)
  Where: `packages/carrier-ups/src/rate.ts`
  What: `await response.json()` in error handler is wrapped in `try/catch` but returns `null` message if it fails, and the main request loop handles only a limited set of HTTP statuses.
  Why it matters: Spec demands structured error mapping.
  Status: Partially compliant; needs stricter mapping to `CarrierError`.

[MEDIUM] Architecture — Config Source of Truth (Ref: Config)
  Where: `packages/carrier-ups/src/config.ts` vs `rate.ts`
  What: Hardcoded fallbacks in implementation (`rate.ts`) conflict with Zod defaults in `config.ts`.
  Why it matters: Spec calls for "Single config module... validated at startup". Current impl forces the implementation to manage config state at runtime.
  Status: Partial compliance; duplication creates risk.

[MEDIUM] Reliability — Input Validation (Ref: CLI)
  Where: `packages/core/src/cli.ts`
  What: CLI arguments are cast to `Number()` without Zod validation.
  Why it matters: Spec requires Zod for all runtime validation.
  Status: Non-compliant with validation mandate.

[LOW] Maintainability — Test Granularity (Ref: Tests)
  Where: `packages/carrier-ups/src/*.test.ts`
  What: Over-reliance on mocking deeply nested JSON structures rather than testing `CarrierProvider` boundary behavior.
  Why it matters: Spec calls for "Tests verify: ... Successful responses parsed...". Currently, tests are brittle.
  Status: Partial compliance; testing methodology diverges from domain-driven design goals.
