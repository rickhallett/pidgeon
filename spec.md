# Pidgeon — Multi-Carrier Shipping Integration Service

## Purpose

A TypeScript service that wraps shipping carrier APIs (starting with UPS Rating API) to provide normalised rate quotes. Designed as a privately scoped npm package monorepo that a team extends over time with additional carriers and operations.

## Architecture

### Monorepo Structure

Bun workspaces with two packages:

- `@pidgeon/core` — domain types, validation schemas, config, error types, carrier provider interface, HTTP layer, CLI
- `@pidgeon/carrier-ups` — UPS-specific implementation: OAuth 2.0 client-credentials flow, rate request/response mapping, response normalisation

### Carrier Abstraction

Hybrid strategy pattern. Core defines a `CarrierProvider` interface with `getRates()` required and optional methods for future operations (`createLabel?()`, `validateAddress?()`, `getTracking?()`). Simple factory maps carrier name to provider instance.

Adding a new carrier = adding a new package implementing the interface. No changes to existing code.

### Normalised Rate Response

The `RateQuote` type — what every caller gets regardless of carrier:

| Field             | Type                          | Purpose                                         |
|-------------------|-------------------------------|--------------------------------------------------|
| carrier           | string                        | Which carrier quoted it                          |
| serviceCode       | string                        | Needed to purchase a label later                 |
| serviceName       | string                        | Human-readable ("2-Day Air", not "03")           |
| totalCharge       | number                        | The number everyone cares about                  |
| currency          | string                        | Always paired with money                         |
| estimatedDelivery | Date | null                  | Absolute date                                    |
| transitDays       | number | null                 | Business days                                    |
| surcharges        | { type: string; amount: number }[] | Fuel, residential, etc.                    |
| billableWeight    | { value: number; unit: string } | What you're actually charged for               |
| guaranteed        | boolean                       | Is the delivery date a guarantee or estimate     |

Callers considered: checkout UI, order management, shipping cost calculator, multi-carrier comparison engine, finance/invoice reconciliation. This field set covers the 80/20 across all of them.

## Domain Types & Validation

Zod for all runtime validation. Schemas defined in core, validated at service boundary before any external call.

- `RateRequest` — origin, destination, packages (dimensions + weight), optional service level
- `Address` — street, city, state, postalCode, countryCode
- `Package` — weight, dimensions (length, width, height), unit system
- `RateQuote` — normalised response (see above)
- `CarrierError` — structured error with code, message, carrier, retriable flag

## Authentication

UPS OAuth 2.0 client-credentials flow:
- Token acquisition via client ID + secret
- In-memory cache with expiry tracking
- Transparent refresh on expiry — caller never sees auth mechanics
- Production note: Redis-backed cache for multi-instance fleet (not implemented, documented)

## Configuration

Single config module using Zod schema validation at startup. Fails fast on missing/invalid config. All secrets and environment-specific values via environment variables. Ships with `.env.example`.

## HTTP Layer

Native fetch (bun built-in). No external HTTP dependency. Thin wrapper providing:
- Exponential backoff retry with configurable max attempts
- Timeout handling
- Reactive 429 rate limit handling (Retry-After header parsing, backoff)
- Request/response logging (sanitised — no auth tokens)
- Structured error mapping for network failures, HTTP errors, malformed responses

Production note: proactive client-side rate limiting (token bucket) at scale.

## Error Handling

Hybrid approach:
- Custom error classes internally (`CarrierAuthError`, `CarrierRateLimitError`, `CarrierNetworkError`, `CarrierValidationError`) — all extend `CarrierError`
- `Result<T>` type at provider boundaries — `getRates()` returns `Result<RateQuote[]>`, never throws
- Internal code may throw; caught and wrapped at the boundary
- Errors are structured, typed, and meaningful to callers

## CLI

Commander-based CLI as dev tooling. Subcommand architecture so the team can add commands as the service grows. Initial command: `rate` for fetching quotes.

## Testing

Bun's built-in test runner (`bun:test`). Integration tests with realistic payloads pulled from UPS API documentation. Tests verify:
- Request payloads correctly built from domain models
- Successful responses parsed and normalised into internal types
- Auth token lifecycle (acquisition, reuse, refresh on expiry)
- Error responses (4xx, 5xx, malformed JSON, timeouts) produce structured errors
- 429 rate limit handling triggers retry logic

HTTP layer stubbed at the fetch level — tests exercise the full code path from domain input to normalised output.

## Tooling

- Bun workspaces (monorepo)
- Bun build (library build step)
- Bun test (test runner)
- Zod (runtime validation)
- Commander (CLI framework)
- TypeScript strict mode

## Out of Scope (documented, not implemented)

- Live UPS API calls (no credentials required)
- Additional carriers (FedEx, USPS, DHL) — architecture supports it
- Additional operations (label purchase, tracking, address validation) — interface supports it
- Proactive rate limiting (token bucket)
- Persistent token cache (Redis)
- UI of any kind
