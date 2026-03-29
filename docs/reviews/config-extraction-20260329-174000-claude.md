# Adversarial Review — Config Extraction (Zod Validation)

**Scope:** Uncommitted changes on `feature/config-extraction` — `config.ts`, `config.test.ts` (13 tests), Zod dependency
**Date:** 2026-03-29T17:40:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 2 HIGH, 3 MEDIUM, 2 LOW

---

## HIGH

### [HIGH] DESIGN — Config module is not consumed by UpsRateProvider; two parallel config shapes exist

```
Where: packages/carrier-ups/src/config.ts, packages/carrier-ups/src/rate.ts:11-14
What: The config module defines UpsConfig with credentials, retry, urls,
      and tokenExpiryBufferSeconds. But UpsRateProvider still takes its
      own UpsRateProviderConfig:

        type UpsRateProviderConfig = {
          readonly fetch: FetchFn;
          readonly credentials: UpsCredentials;
        };

      rate.ts does not import from config.ts. The retry constants are
      still hardcoded at rate.ts:28-31. The URLs are still hardcoded at
      rate.ts:48 and rate.ts:219. The token expiry buffer is hardcoded
      at rate.ts:252 (Math.max(0, expiresIn - 60)).

      The config module defines the right shape and validates it, but
      nothing reads UpsConfig. There is no wiring — loadUpsConfig()
      returns a validated config object, but no code constructs a
      UpsRateProvider from it.

Why it matters: The config module is dead code. It validates environment
      variables but the validated values are never used. The provider
      continues to use its own hardcoded values. A caller who runs
      loadUpsConfig(), gets a valid config, and then creates a provider
      will find that UPS_TIMEOUT_MS=10000 has no effect because the
      provider ignores it.

Evidence:
      grep for "config" imports in rate.ts — none
      rate.ts:28 — const maxAttempts = 4 (hardcoded, not from config)
      rate.ts:48 — hardcoded URL
      rate.ts:219 — hardcoded token URL
      rate.ts:252 — hardcoded 60s buffer

Suggested fix: This is expected to be wired in a follow-up commit (the
      config module is step 9, wiring into the provider is the natural
      next step). But until wired, the module is untestable in
      integration — unit tests pass but the system doesn't use it.
      The review flags this as HIGH because a caller could reasonably
      believe config is active after seeing loadUpsConfig() succeed.
```

### [HIGH] SECURITY — z.coerce.number() silently accepts values that aren't numbers

```
Where: packages/carrier-ups/src/config.ts:4, 22
What: The positiveInt validator uses z.coerce.number():

        const positiveInt = z.coerce.number().int().positive();

      z.coerce.number() calls Number(input) under the hood. This
      accepts strings that are technically parseable but semantically
      wrong:

        Number("") = 0          → fails .positive() ✓ (caught)
        Number("  ") = 0        → fails .positive() ✓ (caught)
        Number("3e2") = 300     → passes .positive() ✗ (unintended)
        Number("0x1F") = 31     → passes .positive() ✗ (unintended)
        Number("Infinity") = ∞  → passes .positive() ✗ (unintended)
        Number(true) = 1        → passes .positive() ✗ (unintended)

      Since these values come from environment variables (always strings),
      the string cases are the real risk. An env var UPS_MAX_ATTEMPTS="3e2"
      (scientific notation) or UPS_TIMEOUT_MS="Infinity" would parse to
      300 and Infinity respectively, both passing validation.

      UPS_TIMEOUT_MS="Infinity" would create a setTimeout(Infinity)
      that never fires — the request hangs forever.

Why it matters: UPS_TIMEOUT_MS="Infinity" creates an infinite timeout.
      UPS_MAX_ATTEMPTS="3e2" (300) creates 300 retry attempts. Both are
      valid per the schema but operationally destructive.

Evidence: config.ts:4 — z.coerce.number()
      No test for edge-case numeric strings.

Suggested fix: Add .finite() to the number chain to reject Infinity.
      Consider z.coerce.number().int().positive().finite(). For stricter
      parsing, use a custom transform that validates the string matches
      /^\d+$/ before coercing. Add a .max() bound on retry-related
      values (e.g., maxAttempts <= 10, timeoutMs <= 60_000).
```

---

## MEDIUM

### [MEDIUM] ARCHITECTURE — Zod lives in carrier-ups, but spec says "schemas defined in core"

```
Where: packages/carrier-ups/package.json, spec.md:43
What: The Zod dependency was added to @pidgeon/carrier-ups:

        "zod": "^4.3.6"

      But spec.md states:

        "Zod for all runtime validation. Schemas defined in core,
         validated at service boundary before any external call."

      The UPS config schema is a carrier-specific concern (UPS credentials,
      UPS URLs), so placing it in the carrier package is defensible. But
      domain schemas (RateRequest, Address, Package) were specified to
      live in core. If Zod is also needed in core later, both packages
      will depend on Zod — which is fine, but the spec implies a single
      location.

Why it matters: Not a bug. An architectural divergence from the spec
      that should be acknowledged. The decision may be correct (carrier
      config belongs with the carrier), but it's undocumented.

Evidence: spec.md:43 — "Schemas defined in core"
      packages/carrier-ups/package.json — zod dependency

Suggested fix: Either update spec.md to say "carrier-specific config
      schemas live in the carrier package; domain schemas live in core,"
      or add a devlog entry explaining the placement decision.
```

### [MEDIUM] TEST QUALITY — Tests mutate process.env globally, risking cross-test contamination

```
Where: packages/carrier-ups/src/config.test.ts:18-38
What: The tests use beforeEach/afterEach to save and restore process.env.
      The restore logic (lines 26-37) iterates all keys and restores
      original values. This is correct in isolation, but:

      1. If a test throws between setEnv() and the assertion, afterEach
         still runs (Bun guarantees this), so cleanup happens. Good.

      2. But process.env is a global singleton shared across all test
         files. If Bun runs test files in parallel (which it does by
         default), config.test.ts mutating process.env will affect
         any other test file that reads process.env concurrently.

      Currently, no other test file reads process.env — they all use
      injected fetch stubs. But if a future test (e.g., an integration
      test) reads UPS_CLIENT_ID from the environment, it could see
      values leaked from config.test.ts.

Why it matters: Latent test isolation issue. Safe today because no
      other tests touch env vars, but fragile if the test suite grows.

Evidence: config.test.ts:21 — savedEnv = { ...process.env }
      Bun default: parallel file execution

Suggested fix: Use loadUpsConfig(env) with the explicit env parameter
      instead of mutating process.env. The function signature already
      accepts an env record:
        loadUpsConfig(env: Record<string, string | undefined> = process.env)
      Tests should pass { UPS_CLIENT_ID: "x", ... } directly, avoiding
      process.env mutation entirely. The beforeEach/afterEach becomes
      unnecessary.
```

### [MEDIUM] CORRECTNESS — Empty string credentials pass initial parsing but will fail at UPS

```
Where: packages/carrier-ups/src/config.ts:8-10, 30-32
What: The schema validates credentials with z.string().min(1, ...).
      However, the input mapping (line 30) defaults to empty string:

        clientId: env.UPS_CLIENT_ID ?? "",

      If UPS_CLIENT_ID is undefined (missing from env), it becomes "".
      The min(1) check correctly rejects this.

      But if UPS_CLIENT_ID is set to a whitespace string like " ",
      it passes min(1) (length 1, the space character). A clientId of
      " " will be base64-encoded and sent to UPS, which will reject
      it with an opaque auth error.

Why it matters: Whitespace-only credentials pass validation but fail
      at UPS with an unhelpful error. The validation should catch this
      at startup, not let it through to runtime.

Evidence: config.ts:8 — z.string().min(1) — no .trim() or whitespace check
      A single space " " has length 1 and passes.

Suggested fix: Add .trim().min(1) to strip whitespace before checking
      length, or add .regex(/\S/) to require at least one non-whitespace
      character.
```

---

## LOW

### [LOW] CORRECTNESS — URL validation accepts any valid URL, not just HTTPS UPS endpoints

```
Where: packages/carrier-ups/src/config.ts:19-20
What: The URL validators use z.string().url():

        rating: z.string().url().default("https://onlinetools.ups.com/...")
        token: z.string().url().default("https://onlinetools.ups.com/...")

      This accepts any valid URL:
        UPS_RATING_URL="http://localhost:8080/anything"  → passes
        UPS_TOKEN_URL="ftp://evil.com/steal"             → passes

      An HTTP (non-HTTPS) URL would send credentials in cleartext. An
      unrelated URL would send UPS credentials to a third party.

Why it matters: Low risk in practice (env vars are set by operators,
      not untrusted input), but the schema could enforce HTTPS as a
      safety net.

Evidence: config.ts:19 — z.string().url() with no protocol constraint

Suggested fix: Add .startsWith("https://") or use
      z.string().url().refine((u) => u.startsWith("https://"), "Must be HTTPS")
      Low priority — env var misconfiguration is an operator error,
      and localhost HTTP is useful during development.
```

### [LOW] TEST QUALITY — No test for invalid URL format

```
Where: packages/carrier-ups/src/config.test.ts
What: The tests verify default URLs and custom CIE URLs, but don't test
      what happens with an invalid URL:

        UPS_RATING_URL="not-a-url"

      The z.string().url() validator should reject it, but no test
      confirms this.

Evidence: No test with an invalid URL string.

Suggested fix: Add a test:
      setEnv({ ...VALID_ENV, UPS_RATING_URL: "not-a-url" })
      expect(result.ok).toBe(false)
      expect(result.error).toContain("UPS_RATING_URL")
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 2 | Config not wired into provider (dead code); z.coerce.number() accepts Infinity and scientific notation |
| MEDIUM | 3 | Zod placement diverges from spec; process.env mutation in tests; whitespace credentials pass |
| LOW | 2 | URL schema accepts non-HTTPS; no invalid URL test |

## Trend

The config module is well-structured — it validates all the values that were previously hardcoded, maps Zod paths back to env var names for clear error messages, and provides sensible defaults. The `loadUpsConfig(env)` signature with injectable env is a good testing seam (though the tests don't use it — see MEDIUM #2).

The biggest gap is the HIGH #1: the config module is entirely standalone. It validates and returns a config object, but `UpsRateProvider` doesn't consume it. The validated `retry.maxAttempts`, `urls.rating`, `urls.token`, and `tokenExpiryBufferSeconds` have no path to the code that uses those values. Until wired, `loadUpsConfig()` is a correct but disconnected module. This is expected per BUILD_ORDER (step 9 extracts config, subsequent work wires it), but the review flags it because a caller could be misled into thinking config is active.

The HIGH #2 (`z.coerce.number()` accepting Infinity) is the most subtle. In production, `UPS_TIMEOUT_MS=Infinity` creates a request that never times out — the exact opposite of what the timeout mechanism was designed to prevent.
