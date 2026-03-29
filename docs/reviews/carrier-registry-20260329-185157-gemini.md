[HIGH] Resilience — Partial failure handling in `getRatesFromAll`
  Where: packages/core/src/registry.ts:L33-L45
  What: The `getRatesFromAll` method swallows individual provider errors and returns a concatenated error string only if no quotes were found at all. If at least one provider succeeds, the errors from other providers are lost entirely.
  Why it matters: This masks partial failures. If UPS succeeds but FedEx (hypothetically) fails, the caller is unaware of the FedEx error, which could be critical for diagnostics or logging.
  Evidence: `quotes.push(...result.data); ... if (quotes.length === 0) { return { ok: false, error: errors.join("; ") }; }`
  Suggested fix: Redefine the result type of `getRatesFromAll` to return both successes and failures (e.g., `Result<{ successful: RateQuote[]; errors: Array<{ carrier: string; error: string }> }>`).

[MEDIUM] Architecture — Registry initialization
  Where: packages/core/src/registry.ts
  What: The `CarrierRegistry` class is a mutable container.
  Why it matters: It relies on manual `register` calls, which can lead to race conditions if multiple parts of the system attempt to register carriers during initialization (e.g., in a serverless or async boot environment).
  Evidence: `private readonly providers = new Map<string, CarrierProvider>();`
  Suggested fix: Consider a factory-based approach or a "frozen" registry that is populated once at startup, or ensure registry registration is strictly performed within the application boot sequence before any `getRatesFromAll` calls occur.

[LOW] Reliability — Case sensitivity logic
  Where: packages/core/src/registry.ts:L6, L14
  What: Uses `toLowerCase()` for keys.
  Why it matters: This is generally safe, but `toLowerCase()` can behave unexpectedly with certain locales (e.g., the Turkish dotless 'i'). While likely not an issue for carrier names, it's good practice to be explicit about collation/normalization if the registry scales.
  Evidence: `name.toLowerCase()`
  Suggested fix: Stick with `toLowerCase()` for now, but keep in mind that if carrier names become localized or more complex, a strict key normalization strategy might be needed.
