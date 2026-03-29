# Pidgeon

Multi-carrier shipping rate integration service. TypeScript monorepo starting with the UPS Rating API. Accepts a rate request (origin, destination, package dimensions/weight) and returns normalised rate quotes. Designed so adding a new carrier means adding a new package that implements the `CarrierProvider` interface -- no changes to existing code.

## Architecture

```
@pidgeon/core                          @pidgeon/carrier-ups
  Types, Zod validation schemas           UPS OAuth 2.0 client-credentials
  CarrierProvider interface               Rate request/response mapping
  CarrierRegistry (multi-carrier)         Response normalisation
  Result<T> error boundary                Retry, backoff, timeout, 429 handling
  CLI (Commander)
          ^
          |
  carrier-ups imports from core
```

Dependency direction: `@pidgeon/core` <-- `@pidgeon/carrier-ups`. Core never imports from a carrier package.

## Quick Start

```bash
bun install
cp .env.example .env.local
# Fill in UPS credentials in .env.local
bun test
```

## Environment Variables

See [`.env.example`](.env.example) for the full list.

**Required:**

| Variable | Description |
|---|---|
| `UPS_CLIENT_ID` | UPS OAuth client ID |
| `UPS_CLIENT_SECRET` | UPS OAuth client secret |
| `UPS_ACCOUNT_NUMBER` | UPS shipper account number |

**Optional (with defaults):**

| Variable | Default | Description |
|---|---|---|
| `UPS_MAX_ATTEMPTS` | `4` | Max retry attempts for transient failures |
| `UPS_BASE_DELAY_MS` | `200` | Base delay for exponential backoff (ms) |
| `UPS_TIMEOUT_MS` | `3000` | Request timeout (ms) |
| `UPS_MAX_RETRY_AFTER_SECONDS` | `5` | Max Retry-After value before giving up |
| `UPS_RATING_URL` | UPS production endpoint | Rating API URL |
| `UPS_TOKEN_URL` | UPS production endpoint | OAuth token URL |
| `UPS_TOKEN_EXPIRY_BUFFER_SECONDS` | `60` | Seconds to refresh token before expiry |

## CLI Usage

```bash
bun run packages/core/src/cli.ts rate \
  --origin-street "123 Main St" \
  --origin-city "Timonium" \
  --origin-state "MD" \
  --origin-postal "21093" \
  --origin-country "US" \
  --dest-street "456 Oak Ave" \
  --dest-city "Alpharetta" \
  --dest-state "GA" \
  --dest-postal "30005" \
  --dest-country "US" \
  --weight 2 --weight-unit lb \
  --length 10 --width 8 --height 6 --dim-unit in
```

Add `--json` for machine-readable output.

## Design Decisions

Architectural decisions, trade-offs, and rationale are recorded in [`devlog.yml`](devlog.yml). Each entry includes the choice made, alternatives considered, and reasoning.

## Testing

```bash
bun test                             # All tests (117 tests, 296 assertions)
bun test packages/core               # Core package only
bun test packages/carrier-ups        # UPS carrier package only
```

Outside-in TDD methodology: walking skeleton first, then deepened layer by layer. Tests exercise the full code path from domain input to normalised output with HTTP stubbed at the fetch level. See [`BUILD_ORDER.md`](BUILD_ORDER.md) for the build sequence.

## Project Status

**Implemented:**

- Rate shopping with normalised `RateQuote` response
- UPS OAuth 2.0 client-credentials flow with token caching and refresh
- Zod-validated domain types (Address, Package, RateRequest)
- Structured error handling with `Result<T>` at provider boundaries
- Retry with exponential backoff, timeout, and 429 rate limit handling
- Zod-validated configuration from environment variables
- Commander-based CLI with `rate` subcommand
- Multi-carrier registry with defensive aggregation

**Deferred (documented in [`devlog.yml`](devlog.yml)):**

- Additional carriers (FedEx, USPS, DHL)
- Additional operations (label purchase, tracking, address validation)
- Proactive client-side rate limiting (token bucket)
- Redis-backed token cache for multi-instance deployments
- Shared HTTP transport layer extracted to core
