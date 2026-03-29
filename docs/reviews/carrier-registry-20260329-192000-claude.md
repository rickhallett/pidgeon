# Adversarial Review — Carrier Registry (Step 11 Multi-carrier Extensibility)

**Scope:** Untracked files on `feature/carrier-registry` — `registry.ts` (52 lines), `registry.test.ts` (242 lines, 11 tests)
**Date:** 2026-03-29T19:20:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW

---

## HIGH

### [HIGH] DESIGN — register() throws but getRatesFromAll() returns Result; inconsistent error boundary contract

```
Where: packages/core/src/registry.ts:8-10, 26-51
What: The registry has two error signaling strategies:

      register() throws:
        if (this.providers.has(key)) {
          throw new Error(`Carrier "${name}" is already registered`);
        }

      resolve() returns Result:
        if (!provider) {
          return { ok: false, error: `Unknown carrier: ${name}` };
        }

      getRatesFromAll() returns Result:
        if (this.providers.size === 0) {
          return { ok: false, error: "No carriers registered" };
        }

      The boundary contract in CLAUDE.md says: "getRates() returns
      Result<RateQuote[]>, never throws. Internal code may throw;
      caught and wrapped at the boundary."

      register() is not a boundary method — it's called during setup.
      But the inconsistency means a caller must know that register()
      throws while every other method returns Result. If register() is
      called inside a try-less async function (e.g., an init routine
      that calls multiple register() calls), the first duplicate
      silently kills the init and the error propagates as an unhandled
      rejection.

      More importantly: if the pattern is that registry methods return
      Result, then a caller who doesn't read the signature carefully
      might do:

        const result = registry.register("ups", provider);
        if (!result.ok) { ... }

      This would "succeed" silently because register() returns void
      (undefined), and `undefined.ok` would throw a TypeError at
      runtime — masking the real error.

Why it matters: Mixed error strategies in a single class create
      a cognitive hazard. The caller must remember which methods throw
      and which return Result. This is exactly the kind of inconsistency
      that causes bugs when a new contributor adds a carrier.

Evidence:
      registry.ts:9 — throw new Error (register)
      registry.ts:17 — return { ok: false } (resolve)
      registry.ts:28 — return { ok: false } (getRatesFromAll)

Suggested fix: Either:
      (a) Make register() return Result<void>:
          return { ok: false, error: `Carrier already registered` }
      (b) Document that register() is a setup-time method that
          throws on programmer error (duplicate registration is a
          bug, not a runtime condition). This is a valid choice —
          duplicates indicate a wiring mistake.
      The key is making the choice explicit and consistent.
```

---

## MEDIUM

### [MEDIUM] DESIGN — getRatesFromAll() swallows errors silently when at least one carrier succeeds

```
Where: packages/core/src/registry.ts:36-50
What: The aggregation logic:

        for (const result of results) {
          if (result.ok) {
            quotes.push(...result.data);
          } else {
            errors.push(result.error);
          }
        }

        if (quotes.length === 0) {
          return { ok: false, error: errors.join("; ") };
        }

        return { ok: true, data: quotes };

      If UPS succeeds and FedEx fails, the caller gets
      { ok: true, data: [UPS quotes] } with no indication that
      FedEx failed. The error is collected into `errors` but
      discarded — it's only used when ALL carriers fail.

      A caller requesting rates from two carriers expects to see
      results from both. Getting only UPS quotes with no warning
      that FedEx is down could lead to mispricing: the user might
      pick UPS Ground at $12.50 not knowing FedEx offered $9.00
      but the request failed.

      The test at line 172 ("returns quotes from healthy carriers
      when one carrier fails") explicitly validates this behavior,
      so it's an intentional design choice. But the test only
      asserts the UPS quote exists — it doesn't verify that the
      FedEx error is accessible anywhere.

Why it matters: Partial failure in a multi-carrier aggregation is
      a significant business event. The caller should at minimum
      be aware that not all carriers responded successfully.

Evidence:
      registry.ts:46-48 — errors discarded when quotes.length > 0
      registry.test.ts:179 — test validates partial success
      No field in Result<RateQuote[]> carries partial-failure warnings

Suggested fix: Either:
      (a) Extend the success result to include warnings:
          { ok: true, data: quotes, warnings: errors }
          (Requires extending the Result type or using a richer return)
      (b) Include a synthetic quote-like marker or log the errors
      (c) Return { ok: false } with partial data when not all carriers
          responded (strict mode)
      (d) Accept the current behavior but add a `--strict` flag or
          config to require all carriers to succeed
```

### [MEDIUM] DESIGN — UpsRateProvider does not structurally satisfy CarrierProvider; no compile-time or runtime verification

```
Where: packages/carrier-ups/src/rate.ts, packages/core/src/index.ts:64-66
What: CarrierProvider is defined in core:

        export type CarrierProvider = {
          getRates(request: RateRequest): Promise<Result<RateQuote[]>>;
        };

      UpsRateProvider has a getRates() method that returns
      Promise<Result<RateQuote[]>>. Structurally, it should satisfy
      CarrierProvider. But there is:

      1. No `implements CarrierProvider` clause on UpsRateProvider
      2. No import of CarrierProvider in rate.ts
      3. No test that verifies: `new UpsRateProvider(...) satisfies CarrierProvider`
      4. No test that registers UpsRateProvider into CarrierRegistry

      TypeScript's structural typing means it works today because the
      shapes happen to match. But if someone changes CarrierProvider
      to add a second method (e.g., `getTrackingInfo?()`) or changes
      the getRates() return type, UpsRateProvider won't fail to
      compile — it will silently stop satisfying the interface.

      The BUILD_ORDER Step 11 says "Extract the carrier interface
      from the concrete UPS implementation." The interface was
      extracted (at Step 10, actually), but the concrete
      implementation was never connected back to it.

Why it matters: The whole point of Step 11 is establishing the
      extension point. Without a verified connection between
      UpsRateProvider and CarrierProvider, the abstraction is
      aspirational, not structural.

Evidence:
      grep for "CarrierProvider" in rate.ts — no matches
      grep for "implements" in rate.ts — no matches
      No integration test registers UpsRateProvider into CarrierRegistry

Suggested fix: Add a type-level assertion in rate.ts:
      import type { CarrierProvider } from "@pidgeon/core";
      // Type-level check — does not emit runtime code
      const _check: CarrierProvider = null! as UpsRateProvider;
      Or add `implements CarrierProvider` to the class (requires
      importing from @pidgeon/core, which is already the dependency
      direction).
```

---

## LOW

### [LOW] CORRECTNESS — carriers() returns lowercase keys, not the original registration name

```
Where: packages/core/src/registry.ts:6-7, 22-24
What: register() normalizes the key to lowercase:

        const key = name.toLowerCase();
        this.providers.set(key, provider);

      carriers() returns the Map keys:

        return [...this.providers.keys()];

      So if a caller registers "UPS", carriers() returns ["ups"].
      The original casing is lost.

      This is consistent — the registry is case-insensitive, so
      storing lowercase is natural. But it means the carrier name
      in the registry ("ups") doesn't match the carrier name in
      quotes ("UPS" — set by UpsRateProvider in RateQuote.carrier).

      If a caller uses registry.carriers() to build a UI or report,
      they'll show "ups" and "fedex" instead of "UPS" and "FedEx".

Why it matters: Minor cosmetic issue. The registry's job is lookup,
      not display. But it's a small surprise that register("UPS")
      then carriers() returns ["ups"].

Evidence:
      registry.ts:7 — name.toLowerCase()
      registry.test.ts:144 — test expects "ups" not "UPS"

Suggested fix: Store the original name alongside the normalized key:
      this.providers.set(key, { name, provider });
      Then carriers() returns original names.
      Low priority — the current behavior is consistent and documented
      by the test.
```

### [LOW] TEST QUALITY — Concurrency test uses wall-clock timing, which is fragile in CI

```
Where: packages/core/src/registry.test.ts:214-241
What: The concurrency test:

        const start = Date.now();
        const result = await registry.getRatesFromAll(DOMESTIC_REQUEST);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(250);

      Three providers each sleep 100ms. If sequential: 300ms. If
      concurrent: ~100ms. The test asserts < 250ms.

      This is a good test in principle — it's the only way to verify
      Promise.all behavior without mocking the scheduler. But
      wall-clock timing tests are fragile:

      - CI under load can add 100-200ms of scheduling jitter
      - Bun's test runner itself adds overhead
      - The current test suite takes 27s total, suggesting some
        timing-sensitive tests already

      The 250ms threshold gives 150ms of headroom over the expected
      100ms, but only 50ms under the 300ms sequential threshold.
      A loaded CI machine could push concurrent execution past 250ms.

Why it matters: Flaky tests erode trust in the test suite. This
      test has failed zero times so far, but timing tests are the
      #1 source of CI flakiness in most projects.

Evidence:
      registry.test.ts:240 — expect(elapsed).toBeLessThan(250)
      Suite total: 27.24s (many timing-sensitive tests)

Suggested fix: Either:
      (a) Widen the margin: expect(elapsed).toBeLessThan(280)
      (b) Use a call-order assertion instead of timing:
          Record the start timestamps of each provider's getRates()
          and verify they overlap (started within 10ms of each other)
      (c) Accept the timing test but add a retry or skip annotation
          for CI environments
```

### [LOW] DESIGN — No export of CarrierRegistry from index.ts

```
Where: packages/core/src/index.ts, packages/core/src/registry.ts
What: CarrierRegistry is defined in registry.ts but not re-exported
      from the package's entry point (index.ts). Currently,
      consumers would need to import directly:

        import { CarrierRegistry } from "@pidgeon/core/src/registry.js";

      or the package.json exports map would need a separate entry.
      The test uses dynamic import("./registry.js") which works
      for co-located test files but not for external consumers.

      This is likely intentional — the registry is still in
      development (untracked file, not yet committed). But once
      committed, it should be importable via the package's public API.

Why it matters: Minor — it's pre-commit code. But a consumer
      (e.g., the CLI wiring or a future entry point) needs a clean
      import path.

Evidence:
      index.ts — no import/export of CarrierRegistry
      package.json exports: { ".": "./src/index.ts" } — single entry

Suggested fix: Add to index.ts:
      export { CarrierRegistry } from "./registry.js";
      Do this when committing the registry.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 1 | Mixed error strategies: register() throws, everything else returns Result |
| MEDIUM | 2 | Partial failures silently swallowed; UpsRateProvider not connected to CarrierProvider |
| LOW | 3 | carriers() loses original casing; timing-based concurrency test; registry not exported |

## Trend

The registry is a clean, minimal abstraction — 52 lines of code that provide register, resolve, list, and aggregate. The `getRatesFromAll()` method using `Promise.all` for concurrent carrier queries is the right design. The test suite covers the important scenarios: happy path, case insensitivity, duplicates, partial failure, total failure, empty registry, and concurrency.

The main structural concern is the partial-failure semantics of `getRatesFromAll()`. The current behavior (return whatever quotes we got, silently discard errors) is defensible for an MVP but creates a business risk: a user doesn't know they're missing cheaper options from a carrier that happened to be down. This is a design decision that should be made explicitly, not inherited by default.

The secondary concern is the gap between CarrierProvider (the abstraction) and UpsRateProvider (the implementation). They're structurally compatible but not formally connected. Adding `implements CarrierProvider` or a type-level assertion would close this gap and make the extension point real rather than aspirational.
