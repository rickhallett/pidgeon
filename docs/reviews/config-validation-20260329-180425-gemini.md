[MEDIUM] Architecture — Config/Environment mapping overhead
  Where: packages/carrier-ups/src/config.ts
  What: The mapping between environment variables and the `UpsConfig` object is manually handled in `loadUpsConfig` and a secondary helper `pathToEnvKey`.
  Why it matters: This creates a maintenance burden. If the `UpsConfig` schema evolves, the manual object construction and mapping logic must be kept in sync, which is prone to error.
  Evidence: `loadUpsConfig` constructs a plain object from `process.env` before passing it to Zod.
  Suggested fix: Consider using Zod's `z.preprocess` or a dedicated library like `dotenv` + `zod` helper that can parse environment variables directly into the schema.

[LOW] Reliability — `coerce` usage with Zod defaults
  Where: packages/carrier-ups/src/config.ts:L3
  What: `z.coerce.number().default(...)` is used.
  Why it matters: `coerce` attempts to transform inputs (like strings from env vars) into numbers. While functional, it can sometimes hide invalid inputs (e.g., an empty string or malformed number might be coerced to 0 instead of triggering a validation error, depending on the implementation).
  Evidence: `const positiveInt = z.coerce.number().int().positive();`
  Suggested fix: Ensure explicit validation logic exists to differentiate between "missing/unset" (triggering default) and "invalid" (triggering error) inputs.

[LOW] Maintainability — Tight coupling between config and default values
  Where: packages/carrier-ups/src/config.ts
  What: Default values for retry logic, URLs, and token buffers are hardcoded within the Zod schema.
  Why it matters: This mixes *validation rules* with *default configuration*. If you wanted to support different defaults for testing versus production, this schema cannot be easily overridden without modifying the code.
  Evidence: `.default(4)`, `.default("https://...")`
  Suggested fix: Separate the schema definition (rules) from the default values. Accept a partial config object in `loadUpsConfig` that merges provided settings with a predefined defaults object.
