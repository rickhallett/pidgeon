[HIGH] Reliability — Number parsing risk
  Where: packages/core/src/cli.ts:L33-L45
  What: Command-line arguments (`opts.weight`, `opts.length`, etc.) are directly cast to `Number()` without validation.
  Why it matters: If a user provides an invalid string (e.g., "abc"), `Number()` results in `NaN`, which will likely lead to invalid API requests, potentially crashing downstream or causing silent failures in `getRates` implementations.
  Evidence: `weight: { value: Number(opts.weight), ... }`
  Suggested fix: Add validation logic to `action` or use a custom commander parser to ensure all numeric inputs are valid numbers before constructing the `RateRequest`.

[MEDIUM] Maintainability — Tight coupling between CLI and `RateRequest` shape
  Where: packages/core/src/cli.ts
  What: The CLI implementation is explicitly building the complex `RateRequest` object, including deep property mapping.
  Why it matters: If the `RateRequest` type definition changes (e.g., adding more nested objects), the CLI layer must be manually updated. This duplication of knowledge about the request structure is brittle.
  Evidence: Manual object construction in the `.action` handler.
  Suggested fix: Introduce a builder or factory function within `core/src/index.ts` that the CLI can use to translate CLI options into a domain-validated `RateRequest`.

[LOW] Reliability — CLI output suppression
  Where: packages/core/src/cli.ts:L11
  What: `program.configureOutput({ writeErr: () => {}, writeOut: () => {} });` suppresses all default stdout/stderr.
  Why it matters: While good for test-controlled execution, this makes it impossible to rely on standard `commander` behavior (like help output, argument errors) in an interactive user context without extra plumbing.
  Evidence: `writeErr: () => {}, writeOut: () => {}`
  Suggested fix: Ensure that `writeErr` and `writeOut` are correctly plumbed to standard error/output when running in a production shell environment, perhaps by making them configurable via `ProgramDeps`.
