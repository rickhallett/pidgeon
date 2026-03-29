# Build Order

Red-green-red TDD. Each step is one or more atomic commits.
Test first, implement, commit. No skipping ahead.

## 1. Scaffold
Monorepo structure, bun workspaces, tsconfig, .gitignore.
No code — just the skeleton.

## 2. Core domain types
Address, Package, RateRequest, RateQuote, ServiceLevel.
Types only — no validation, no logic.

## 3. Zod schemas
Runtime validation schemas for all domain types.
Tests: valid input passes, invalid input fails with structured errors.

## 4. Error types
CarrierError base class + subclasses (Auth, RateLimit, Network, Validation, Timeout).
Result<T> type. Tests: error construction, instanceof checks, Result narrowing.

## 5. Config module
Zod-validated config from env vars. .env.example.
Tests: valid config loads, missing required vars throws at startup.

## 6. HTTP layer
Fetch wrapper: retry with exponential backoff, timeout, 429 handling, sanitised logging.
Tests: retry behaviour, backoff timing, timeout, 429 → Retry-After, log sanitisation.

## 7. Carrier interface
CarrierProvider interface (getRates required, optional createLabel/validateAddress/getTracking).
CarrierFactory: register + resolve by name.
Tests: factory registration, resolution, unknown carrier error.

## 8. UPS auth
OAuth 2.0 client-credentials: token acquisition, in-memory cache, transparent refresh.
Tests: acquires token, reuses cached token, refreshes expired token, handles auth failure.

## 9. UPS rate mapper
Request builder: domain types → UPS API request payload.
Response normaliser: UPS API response → RateQuote[].
Tests: request shape matches UPS spec, response parsed into normalised quotes.

## 10. UPS provider
Wire auth + HTTP + mapper into CarrierProvider implementation.
getRates: validate → authenticate → build request → call API → normalise → return Result.
Tests: full happy path, auth failure, network error, malformed response, 429.

## 11. Integration tests
End-to-end with stubbed fetch. Realistic UPS payloads from docs.
Covers: request building, response parsing, auth lifecycle, error paths.

## 12. CLI
Commander-based. `rate` subcommand exercising the real service.
Stubbed HTTP for demo. Help text, structured output.

## 13. README + polish
Design decisions, how to run, what you'd improve.
Final .env.example review. Commit history cleanup if needed.
