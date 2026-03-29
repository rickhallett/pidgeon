[MEDIUM] API Contract — Missing response validation
  Where: packages/carrier-ups/src/rate.ts:25
  What: The response is directly cast to `UpsRateResponseEnvelope` via `as` without any runtime validation (e.g., Zod).
  Why it matters: If the UPS API returns a different shape (e.g., an error response instead of a success, or missing fields), `json.RateResponse.RatedShipment` will cause a runtime exception (Cannot read properties of undefined).
  Evidence: `const json = await response.json() as UpsRateResponseEnvelope;`
  Suggested fix: Implement Zod schemas for the UPS API response and parse the JSON before access.

[HIGH] Error Handling — Fetch failures not handled
  Where: packages/carrier-ups/src/rate.ts:20
  What: `await this.config.fetch(...)` is called without a `try/catch` block.
  Why it matters: If a network error occurs (DNS failure, timeout), `fetch` will throw an error, causing the entire `getRates` function to crash, which is not caught at the boundary.
  Evidence: `const response = await this.config.fetch(...)`
  Suggested fix: Wrap the `fetch` call in a `try/catch` and return an `ok: false` result for network/system errors.

[MEDIUM] Error Handling — HTTP non-200 responses ignored
  Where: packages/carrier-ups/src/rate.ts:20
  What: The code does not check `response.ok` or `response.status` after the `fetch` call.
  Why it matters: If UPS returns a 401 Unauthorized, 429 Too Many Requests, or 500 Internal Server Error, the code will proceed as if it were a valid 200 response, likely leading to parsing errors.
  Evidence: The code directly calls `await response.json()`.
  Suggested fix: Check `response.ok`. If false, handle the HTTP error (parse error response body if available) and return an `ok: false` Result.

[LOW] Type Safety — Numeric string parsing risk
  Where: packages/carrier-ups/src/rate.ts:33
  What: `parseInt` is used on a field that might be empty or improperly formatted.
  Why it matters: While the current test case is fine, if UPS returns an empty string or non-numeric value for `BusinessDaysInTransit`, `parseInt` might return `NaN` or incorrect results.
  Evidence: `transitDays: parseInt(shipment.TimeInTransit.ServiceSummary.EstimatedArrival.BusinessDaysInTransit, 10),`
  Suggested fix: Add robust parsing/validation for numeric strings, ensuring they are valid numbers before `parseInt`/`parseFloat`.

[HIGH] Test Quality — Incomplete assertions in error paths
  Where: packages/carrier-ups/src/rate-errors.test.ts
  What: The tests verify that `result.ok` is `false`, but they often rely on loose string matching (e.g., `result.error.toContain("network")`).
  Why it matters: If the code returns an error for the wrong reason (e.g., a parsing error instead of a network error), the test will still pass.
  Evidence: `expect(result.error).toContain("network");`
  Suggested fix: Assert on specific error codes or error types, not just string fragments.
