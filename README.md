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

## Key Takeaways

This project was as much an exercise in AI-assisted development process as it was in shipping a carrier integration. Here's what I took away from ~70 commits, 48 review documents, and a full spec-to-ship cycle with multiple AI models.

### On the code

- **Error boundaries before features.** Implementing `Result<T>` at the provider boundary *before* deepening request/response logic prevented cascading failures and forced exhaustive error handling from the start. The build plan originally had this later; moving it up was the single most impactful sequencing decision.
- **Zod as the single source of truth.** Using `z.infer` to bridge runtime validation and TypeScript types eliminated drift between API shapes and domain models. When the schema changed, types followed automatically.
- **Extraction is riskier than greenfield.** Pulling the HTTP layer out of `carrier-ups` into core introduced three bugs despite a full test suite. The failure mode was assuming extraction is mechanical — it's not. Context changes correctness. Write the target interface first, then implement by referencing the old code, not by moving it.

### On the process

- **The plan is a live document.** `BUILD_ORDER.md` should have been updated at the moment I decided to resequence the error boundary, not reconstructed after the fact. A plan that doesn't reflect reality loses its value as a coordination artifact.
- **TDD discipline is hard to sustain at machine speed.** Outside-in TDD was directionally correct, but several steps collapsed red and green into single commits. The evidence of test-driven work matters almost as much as the work itself — especially when the commit history is part of the deliverable.
- **Triage > volume.** The most useful review pattern was: collect independent reviews, identify consensus and severity, decide what to fix now vs. defer, and record *why*. Without that filter, more review output just produces more noise.

### On working with AI

- **The operator's real job is triage, not coding.** Across the full build, AI did most of the writing. My highest-value actions were reordering the build plan after reviews, deciding which findings to fix vs. defer, and catching when "spec compliance" was nominal rather than behavioural. Decision quality matters more than output volume.
- **Velocity outpaces verification by default.** AI writes fast. Reviews find issues fast. But the bottleneck is *deciding what to do about findings*. The fix isn't "slow down" — it's building forced pauses between roles. Commit the triage. Switch to coder. Commit the code. The pause between roles is where quality lives.
- **Fresh context beats accumulated context.** The most valuable adversarial reviews started from scratch. Later rounds found fewer critical issues partly because the models had absorbed so much prior context they were anchored by it. The first cross-family review of a new slice is worth roughly 10× the third review of the same slice.
- **Process rules are easier to write than to follow.** `CLAUDE.md` contains detailed rules: atomic commits, TDD discipline, never work on main, separate agent responsibilities. The meta-review found partial compliance. Maintaining discipline requires constant friction against the natural tendency — human and AI alike — to just ship the next thing. Next time, I'd either simplify the rules to what can actually be sustained, or build mechanical enforcement (pre-commit hooks, CI checks) rather than relying on discipline alone.

The full learning log with additional detail lives in [`LEARNINGS.md`](LEARNINGS.md).

## Testing

```bash
bun test                             # All tests (161 tests, 412 assertions)
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

**Deferred (see [`docs/FUTURE_WORK.md`](docs/FUTURE_WORK.md) for full list):**

- Additional carriers (FedEx, USPS, DHL)
- Additional operations (label purchase, tracking, address validation)
- Proactive client-side rate limiting (token bucket)
- Redis-backed token cache for multi-instance deployments
