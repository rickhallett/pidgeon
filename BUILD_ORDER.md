# Build Order

Outside-in TDD. Walking skeleton first, then deepen.
Types, errors, and config are extracted from working code, not prescribed upfront.
Each step is one or more atomic commits. Test first, implement, commit.

## 1. Scaffold
Monorepo structure, bun workspaces, tsconfig, .gitignore.
No code — just the skeleton.

## 2. Walking skeleton (red)
One test: "given a rate request, get back a normalised rate quote."
Forces the entire vertical slice into existence as minimal shells —
types, provider interface, UPS implementation, HTTP call, response mapping.
Nothing works yet, but the shape of the system exists end-to-end.

## 3. Walking skeleton (green)
Hardcode everything. Fake HTTP response, hardcoded mapping, types just
wide enough to compile. The test goes green. Working through-line to
refactor into.

## 4. Real request building
Test that domain input produces correct UPS API payload shape.
Types and Zod schemas for the request side emerge here because
they're needed, not because they're next on a list.

## 5. Real response normalisation
Test that a realistic UPS response payload maps to RateQuote.
Types and schemas for the response side emerge here.
Surcharges, billing weight, guaranteed delivery.

## 6. Error paths
Now that happy path works, break it. Network timeout, 429, 401,
malformed JSON, validation failure. Error classes and Result type
emerge from actual failure modes, not from a taxonomy designed upfront.

## 7. Auth lifecycle
Token acquisition, caching, refresh on expiry.
Layered onto the working skeleton — not a standalone module.

## 8. HTTP hardening
Retry with exponential backoff, 429 handling, timeout, sanitised logging.
Layered onto working skeleton, tested against real failure scenarios
already defined in step 6.

## 9. Config
Extract hardcoded values into Zod-validated config.
Comes late because now we know what actually needs configuring.

## 10. CLI
Commander-based. Wire the working service into a `rate` subcommand.
Real service to call, not a demo of imaginary plumbing.

## 11. Multi-carrier extensibility
Extract the carrier interface from the concrete UPS implementation.
Factory/registry. Refactored from working code, not designed in the abstract.

## 12. Polish
README, .env.example, final test coverage review, commit history check.
