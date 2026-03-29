[MEDIUM] Type Safety — Excessive `as any` casting
  Where: packages/carrier-ups/src/request-builder.test.ts
  What: Multiple tests use `as any` to traverse the captured request body.
  Why it matters: This bypasses TypeScript's type checking, making the tests fragile; if the internal API shape changes, these tests will fail at runtime (or worse, not fail when they should).
  Evidence: `const shipFrom = captured().body as any;`, `const shipper = (captured().body as any).RateRequest...`
  Suggested fix: Define explicit TypeScript interfaces for the UPS API request payload and cast to those instead of `any`.

[LOW] Reliability — Implicit dependency on UPS API version
  Where: packages/carrier-ups/src/request-builder.test.ts:182
  What: The test hardcodes the URL `https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit`.
  Why it matters: If the UPS API version is updated, the test will fail, requiring a manual update.
  Evidence: `expect(String(captured().url)).toBe("https://onlinetools.ups.com/api/rating/v2409/Shoptimeintransit");`
  Suggested fix: Consider defining the base URL and version as a constant in the provider and reference that constant in the test.

[LOW] Maintainability — Repetitive setup logic
  Where: packages/carrier-ups/src/request-builder.test.ts
  What: `await provider.getRates({...})` is repeated in almost every test.
  Why it matters: If the `RateRequest` interface changes, every single test will need to be updated.
  Evidence: The test `getRates` call is repeated 10+ times.
  Suggested fix: Use a helper factory or `beforeEach` to generate common test data.
