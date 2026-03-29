[CRITICAL] Architectural Integrity — Boundary contract violation
  Where: packages/carrier-ups/src/rate.ts
  What: `getRates` performs `await response.json()` without ensuring the body exists or matches the expected schema.
  Why it matters: The boundary contract mandates returning `Result` and never throwing. A malformed JSON response causes runtime errors, effectively throwing outside the expected error handling flow.
  Evidence: `const json = await response.json() as UpsRateResponseEnvelope;` (no guardrails)
  Suggested fix: Implement Zod schema parsing at the service boundary.

[HIGH] Error Handling — Non-exhaustive HTTP handling
  Where: packages/carrier-ups/src/rate.ts
  What: The service assumes any response that can be parsed as JSON is success (200). 4xx/5xx responses are treated as valid result data if they happen to parse into the structure.
  Why it matters: UPS error payloads are returned as 4xx/5xx, which should trigger specific error handling logic, not attempted JSON parsing.
  Evidence: `await response.json()` is called without `response.ok` check.
  Suggested fix: Explicitly check `response.ok` and handle the response body accordingly.

[MEDIUM] Reliability — Fragile numeric parsing
  Where: packages/carrier-ups/src/rate.ts:33
  What: `parseInt` is used on `BusinessDaysInTransit` without validation or handling for non-numeric strings.
  Why it matters: If the UPS API changes or returns a non-numeric string, this field becomes `NaN`, silently corrupting the domain model.
  Evidence: `parseInt(shipment.TimeInTransit.ServiceSummary.EstimatedArrival.BusinessDaysInTransit, 10)`
  Suggested fix: Use a safer conversion helper that returns a default or validated `Result`.

[HIGH] Test Quality — Insufficient assertion rigor
  Where: packages/carrier-ups/src/rate-errors.test.ts
  What: Error path tests use loose string inclusion checks rather than type-safe error identification.
  Why it matters: This masks incorrect error mapping, as multiple failure paths could inadvertently contain the same string fragment.
  Evidence: `expect(result.error).toContain("network");`
  Suggested fix: Use structured Error objects or defined error codes instead of string fragments for assertions.
