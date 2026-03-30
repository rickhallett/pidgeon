# Architecture Review — Maintainability and Extension

**Scope:** committed changes through `0ae8f4a6f7881df6877ea8c4cde8f72f94aaf3f9`, with emphasis on future team members adding carriers and new carrier operations
**Date:** 2026-03-30T06:19:36Z
**Model:** codex
**Method:** targeted review of package boundaries, exported interfaces, core transport, registry, CLI, UPS provider composition, and direct tests in `packages/core/src/*.test.ts` and `packages/carrier-ups/src/*.test.ts`

---

[HIGH] Architecture — `CarrierProvider` mixes a concrete current contract with speculative optional capabilities

  Where: `packages/core/src/index.ts:58`
  What: the main provider interface requires `getRates()` but also carries optional `createLabel()`, `validateAddress()`, and `getTracking()` methods. That creates one broad interface whose actual meaning depends on runtime capability checks rather than a clear compile-time contract.
  Why it matters: future contributors adding a second carrier or a second operation will not have a crisp abstraction to implement. "Method absent" can mean unsupported, not started, forgotten, or intentionally omitted. That ambiguity spreads into calling code and test design.
  Evidence: `CarrierProvider` is defined as a single interface with optional future methods in `packages/core/src/index.ts`, and the registry stores that single wide type in `packages/core/src/registry.ts`.
  Suggested fix: split capabilities into explicit interfaces such as `RateProvider`, `LabelProvider`, `AddressValidationProvider`, and `TrackingProvider`, then compose them where needed instead of encoding capability optionality inside one umbrella type.

[HIGH] Cohesion — `UpsRateProvider` is doing orchestration, auth, transport wiring, request building, and response parsing in one file

  Where: `packages/carrier-ups/src/rate.ts:46`
  What: the UPS provider class validates input, caches and refreshes OAuth tokens, builds request payloads, configures and invokes the shared HTTP client, retries auth failures, parses UPS responses, and maps errors.
  Why it matters: this is still manageable for one rating endpoint, but it is not a scalable shape for "add label purchase", "add tracking", or "add a second carrier". Future changes in one concern will require editing a file that also contains unrelated concerns, which raises regression risk and makes onboarding slower.
  Evidence: token acquisition starts at `acquireToken()`, request construction at `buildRequestBody()`, response mapping at `mapResponse()`, and request orchestration at `executeWithToken()`, all inside the same class in `packages/carrier-ups/src/rate.ts`.
  Suggested fix: split the UPS integration into focused modules for auth, request building, response parsing, and provider orchestration. Keep the provider as a thin coordinator rather than the home for all UPS-specific logic.

[MEDIUM] Architecture — The shared HTTP layer is exported from core but still behaves like a rating-specific JSON helper

  Where: `packages/core/src/http.ts:81`
  What: `httpRequest()` lives in core, but it assumes JSON success responses, string bodies, carrier-oriented error wording, and even logs `"rating request"` from the generic transport layer.
  Why it matters: future contributors will try to reuse this for token endpoints, label purchase, tracking, or non-JSON responses. At that point they either bend the abstraction into shapes it was not designed for or duplicate transport logic outside core, undermining the reason the extraction happened.
  Evidence: the generic module logs `"rating request"` at `packages/core/src/http.ts:103`, parses success bodies only with `response.json()` at `packages/core/src/http.ts:180`, and offers only an `ErrorBodyParser` extension point rather than a general response-decoding strategy.
  Suggested fix: make transport concerns independent from response decoding. Use neutral operation naming, allow caller-provided success parsers, and make retry policy explicit per request so the module reads like infrastructure rather than extracted UPS rate logic.

[MEDIUM] Error Model — Structured carrier errors are flattened back into a string at the aggregate boundary

  Where: `packages/core/src/registry.ts:51`
  What: individual providers return structured `CarrierError`, but when every provider fails the registry returns `error: string` built by joining messages, while also returning `failures`.
  Why it matters: future callers will have two competing error channels and will need special-case logic to get back to structured information. That weakens the package boundary exactly where multi-carrier behavior should be most consistent.
  Evidence: `AggregatedRateResult` in `packages/core/src/index.ts` uses `error: string` for total failure, and `CarrierRegistry.getRatesFromAll()` builds that string by joining failure messages in `packages/core/src/registry.ts`.
  Suggested fix: define a structured aggregate error type and use it as the primary failure contract. Preserve human-readable summary text inside that type rather than making the top-level error field a lossy string.

[MEDIUM] Type Design — Shared domain types are still too stringly typed for a package intended to be extended

  Where: `packages/core/src/schemas.ts:3`
  What: units, country codes, service codes, and several other boundary fields remain broad strings.
  Why it matters: the current shape keeps iteration fast, but it pushes normalization and validation responsibility into every adapter. A second carrier implementation is likely to repeat unit-mapping and string-cleanup logic instead of inheriting stronger defaults from core.
  Evidence: `WeightSchema.unit`, `DimensionsSchema.unit`, and other boundary fields in `packages/core/src/schemas.ts` are defined as generic non-empty strings.
  Suggested fix: tighten the shared domain model where the valid sets are already known, starting with weight and dimension units. Avoid over-modeling carrier-specific values, but strengthen the obvious shared enums and branded identifiers.

[LOW] Extension Ergonomics — The registry is functional but too bare to be the long-term integration point

  Where: `packages/core/src/registry.ts:3`
  What: the registry is a simple `Map<string, CarrierProvider>` with registration, lookup, and multi-carrier rate aggregation.
  Why it matters: as the number of carriers and capabilities grows, future contributors will want to know which carrier supports which operations, how providers are constructed, and what metadata belongs to each integration. A plain map of provider instances does not carry enough structure for that evolution.
  Evidence: `CarrierRegistry` stores only provider instances and lower-cased names in `packages/core/src/registry.ts`.
  Suggested fix: register typed carrier descriptors or factories that include carrier id and supported capabilities, so the registry becomes a real extension boundary instead of only a lookup table.

## Assessment

The code is still coherent enough for a small team to work on, and the test suite is stronger than the current architecture, which is a good foundation. The main issue is not that the abstractions are wrong in principle; it is that they are one step behind the product direction the repository is already signaling. The current design works for a single UPS rate operation, but future contributors adding new carriers or new UPS operations will pay increasing costs in file size, implicit contracts, and transport reuse friction.

## Changes I Would Make First

1. Split `CarrierProvider` into explicit capability interfaces so support is visible in types rather than implied by optional methods.
2. Break `packages/carrier-ups/src/rate.ts` into separate auth, request-builder, response-parser, and provider orchestration modules.
3. Refactor `packages/core/src/http.ts` into a transport primitive with neutral logging and caller-provided response parsing.
4. Make aggregate multi-carrier failures structured end to end instead of flattening them to a string.
5. Tighten the shared domain model in `packages/core/src/schemas.ts` for the obvious common enums such as units.
