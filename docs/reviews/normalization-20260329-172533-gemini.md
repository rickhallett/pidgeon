[HIGH] Reliability — Brittle Response Normalization
  Where: packages/carrier-ups/src/rate.ts
  What: Normalization logic directly indexes into deeply nested UPS response objects (e.g., `RatedShipment[0].TimeInTransit.ServiceSummary...`).
  Why it matters: If the UPS response format changes (e.g., if `RatedShipment` is omitted, or `ServiceSummary` moves), the normalization logic will throw a `TypeError` (e.g., "Cannot read property of undefined").
  Evidence: Direct access patterns observed in walking skeleton.
  Suggested fix: Implement defensive navigation (Optional Chaining `?.` and Nil Coalescing `??`) and Zod-based validation to ensure the response structure is as expected *before* normalisation begins.

[MEDIUM] Maintainability — Hardcoded Mapping Logic
  Where: packages/carrier-ups/src/rate.ts
  What: The logic mapping raw UPS codes/fields to `pidgeon/core` models is monolithic.
  Why it matters: Adding more services or carrier options will bloat the existing `getRates` method, making it difficult to test or maintain.
  Evidence: `quote.serviceCode = ...`
  Suggested fix: Refactor into a dedicated `normalizer` function or class that encapsulates the translation logic from `UpsRateResponseEnvelope` to `RateQuote[]`.

[LOW] Data Integrity — Implicit numeric conversion
  Where: packages/carrier-ups/src/rate.ts
  What: String-to-number conversions (e.g., `MonetaryValue`, `BusinessDaysInTransit`) are performed using `parseFloat`/`parseInt` without robust error handling.
  Why it matters: In case of unexpected carrier data formats (e.g., comma separators in numeric strings, or empty strings), this could result in `NaN` or incorrect values being propagated to the core domain models.
  Evidence: `parseFloat(shipment.TotalCharges.MonetaryValue)`
  Suggested fix: Create a centralized `safeParseFloat` / `safeParseInt` utility that returns `Result` or a default value on failure.
