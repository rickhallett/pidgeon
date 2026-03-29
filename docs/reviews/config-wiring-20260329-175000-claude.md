# Adversarial Review — Config Wiring (Step 9 Integration)

**Scope:** Commits `d353542..2eff4fe` — config wiring into UpsRateProvider, `config-wiring.test.ts` (4 tests), rate.ts changes
**Date:** 2026-03-29T17:50:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 1 HIGH, 3 MEDIUM, 2 LOW

---

## HIGH

### [HIGH] DESIGN — UpsConfig (Zod output) and UpsRateProviderConfig (provider input) are two separate types with no bridge

```
Where: packages/carrier-ups/src/config.ts:25, packages/carrier-ups/src/rate.ts:23-29
What: loadUpsConfig() returns UpsConfig (Zod inferred):
        {
          credentials: { clientId, clientSecret, accountNumber }
          retry: { maxAttempts, baseDelayMs, timeoutMs, maxRetryAfterSeconds }
          urls: { rating, token }
          tokenExpiryBufferSeconds: number
        }

      UpsRateProvider constructor accepts UpsRateProviderConfig:
        {
          fetch: FetchFn
          credentials: UpsCredentials
          retry?: RetryConfig
          urls?: UrlConfig
          tokenExpiryBufferSeconds?: number
        }

      These types are structurally compatible for credentials, retry,
      urls, and tokenExpiryBufferSeconds. But:

      1. There is no function that takes UpsConfig and produces
         UpsRateProviderConfig. The caller must manually spread:

           const config = loadUpsConfig();
           if (!config.ok) throw new Error(config.error);
           const provider = new UpsRateProvider({
             fetch: globalThis.fetch,
             ...config.data,
           });

         This works but is undocumented and untested.

      2. The Zod schema's retry and urls produce REQUIRED objects with
         defaults. But UpsRateProviderConfig declares retry? and urls?
         as optional. If a caller passes UpsConfig directly, the
         optional fields are present (because Zod fills defaults).
         If a caller constructs the config manually (as all existing
         tests do), retry and urls are omitted and the provider falls
         back to hardcoded defaults in the destructuring at line 43.

         These two paths produce IDENTICAL behaviour only because the
         Zod defaults and the destructuring defaults are the same values.
         If someone changes the Zod default for maxAttempts to 3 but
         forgets to change the destructuring default at line 43, the
         two paths diverge silently.

      3. No test verifies that loadUpsConfig() output can be passed
         directly to new UpsRateProvider(). The config-wiring tests
         construct UpsRateProviderConfig manually.

Why it matters: Duplicate defaults in two locations (Zod schema and
      destructuring defaults) is a maintenance hazard. The first
      person to change a default will change it in one place and miss
      the other. The system will appear to work until a caller uses
      the path that reads the other default.

Evidence:
      config.ts:13 — maxAttempts default: 4
      rate.ts:43 — maxAttempts default: 4 (destructuring)
      config.ts:15 — timeoutMs default: 3_000
      rate.ts:43 — timeoutMs default: 3_000 (destructuring)
      No test passes loadUpsConfig().data to UpsRateProvider constructor.

Suggested fix: Either:
      (a) Make retry and urls REQUIRED in UpsRateProviderConfig and
          remove the destructuring defaults. The provider always
          receives fully-populated config from loadUpsConfig().
      (b) Add an integration test that passes loadUpsConfig() output
          plus a fetch to UpsRateProvider and verifies end-to-end.
      (c) Add a factory function:
          export function createUpsProvider(config: UpsConfig, fetch: FetchFn): UpsRateProvider
          that serves as the documented bridge.
```

---

## MEDIUM

### [MEDIUM] TEST QUALITY — Token expiry buffer test proves direction but not magnitude

```
Where: packages/carrier-ups/src/config-wiring.test.ts:137-166
What: The test sets tokenExpiryBufferSeconds=300 with expires_in=200.
      Since buffer > expires_in, the token is immediately expired, so
      every call re-acquires. The test asserts tokenCalls is 2 after
      2 getRates() calls.

      This proves the buffer IS being read (otherwise the default 60s
      buffer would leave 140s of valid token, and tokenCalls would be 1).
      Good.

      BUT: the test doesn't prove the buffer is applied CORRECTLY.
      It would also pass if the implementation subtracted buffer * 2,
      or if it compared >= instead of <, or if it set expiresAt to 0
      when buffer > expires_in. Any of these bugs would still cause
      immediate re-acquisition.

      A more precise test would use a buffer that's LESS than expires_in
      and verify the exact threshold. For example:
        expires_in=10, buffer=3 → token valid for 7 seconds
        Call at t=0 → uses cached token
        Call at t=8 → re-acquires (past 7s)

Why it matters: The test catches "config is not read" but not
      "config is applied with wrong arithmetic."

Evidence: config-wiring.test.ts:158 — tokenExpiryBufferSeconds: 300
      config-wiring.test.ts:145 — expires_in: 200
      300 > 200 → always expired → proves config is read, not that
      arithmetic is correct.

Suggested fix: Add a second test with buffer < expires_in that verifies
      the token is cached (one acquisition for two calls). This
      brackets the behaviour from both sides.
```

### [MEDIUM] TEST QUALITY — No test verifies baseDelayMs, timeoutMs, or maxRetryAfterSeconds wiring

```
Where: packages/carrier-ups/src/config-wiring.test.ts:112-133
What: The wiring tests cover:
      - URLs: rating and token (2 tests) ✓
      - retry.maxAttempts (1 test) ✓
      - tokenExpiryBufferSeconds (1 test) ✓

      But retry.baseDelayMs, retry.timeoutMs, and
      retry.maxRetryAfterSeconds have no wiring tests. The provider
      reads them from config (line 43), but no test verifies that
      a custom value actually takes effect.

      For example, if the destructuring at line 43 had a typo:
        const { maxAttempts = 4, baseDelayMs = 200, timeoutMS = 3_000 }
      (note: timeoutMS with capital S instead of timeoutMs), the
      config value would be ignored and the default used. No test
      would catch this.

Why it matters: Three of six configurable values are untested at the
      integration level. The destructuring defaults mask any wiring bug.

Evidence: config-wiring.test.ts has 4 tests. Missing: baseDelayMs,
      timeoutMs, maxRetryAfterSeconds.

Suggested fix: Add tests for at least timeoutMs (verifiable by
      configuring a very short timeout and checking for timeout error)
      and maxRetryAfterSeconds (verifiable with a 429 + Retry-After
      header exceeding the configured max).
```

### [MEDIUM] CORRECTNESS — Optional chaining on urls creates fallback chains evaluated on every call

```
Where: packages/carrier-ups/src/rate.ts:60, 231
What: The rating URL is resolved on every retry attempt:

        this.config.fetch(this.config.urls?.rating ?? "https://...")

      And the token URL on every token acquisition:

        this.config.fetch(this.config.urls?.token ?? "https://...")

      This is correct but wasteful — the optional chaining and
      nullish coalescing are evaluated on every call to getRates()
      and acquireToken(). More importantly, if someone later makes
      urls mutable (e.g., for URL rotation), the URL could change
      between retry attempts within a single getRates() call.

      More subtly: the config is typed as readonly, so mutation
      shouldn't happen. But the optional chaining creates a code
      pattern where the URL is never resolved once and stored —
      it's re-derived every time.

Why it matters: Low practical risk (the config is readonly and
      ?? is cheap). But it's a design smell: the provider should
      resolve its effective URLs once in the constructor, not on
      every request.

Evidence: rate.ts:60 — urls?.rating ?? fallback (inside retry loop)
      rate.ts:231 — urls?.token ?? fallback (inside acquireToken)

Suggested fix: Resolve URLs in the constructor:
      this.ratingUrl = config.urls?.rating ?? "https://...";
      this.tokenUrl = config.urls?.token ?? "https://...";
      Then use this.ratingUrl directly. This also makes it easier
      to log the effective URL at construction time.
```

---

## LOW

### [LOW] DESIGN — RetryConfig and UrlConfig types in rate.ts duplicate Zod-inferred shape

```
Where: packages/carrier-ups/src/rate.ts:11-21
What: rate.ts defines its own RetryConfig and UrlConfig types:

        type RetryConfig = {
          readonly maxAttempts: number;
          readonly baseDelayMs: number;
          readonly timeoutMs: number;
          readonly maxRetryAfterSeconds: number;
        };

      These are structurally identical to the Zod-inferred
      UpsConfig["retry"] and UpsConfig["urls"]. But they're
      independent types with no import relationship.

      If the Zod schema adds a new retry field (e.g., jitterMs),
      RetryConfig won't have it. If RetryConfig changes a field
      name, the Zod schema won't know.

Why it matters: Two sources of truth for the same shape. Low risk
      today (they're identical), but a maintenance hazard.

Evidence: rate.ts:11-21 — manual types
      config.ts:25 — UpsConfig (Zod inferred) with same shape

Suggested fix: Export the sub-types from config.ts:
      export type RetryConfig = UpsConfig["retry"];
      export type UrlConfig = UpsConfig["urls"];
      Import in rate.ts instead of defining locally.
```

### [LOW] TEST QUALITY — Config wiring tests use hardcoded baseDelayMs=10 to speed up retries

```
Where: packages/carrier-ups/src/config-wiring.test.ts:125
What: The maxAttempts test passes baseDelayMs: 10 to avoid waiting
      for real exponential backoff delays. This is pragmatic — without
      it, the test would wait 200 + 400ms for two retries.

      But it inadvertently tests that baseDelayMs IS read from config
      (the test runs fast, proving the 200ms default was overridden).
      This is an accidental proof that baseDelayMs wiring works —
      but only if you know the default is 200ms. The test doesn't
      assert on baseDelayMs explicitly.

Why it matters: Accidental test coverage is fragile. If the default
      changes to 10ms, this test still passes but no longer proves
      baseDelayMs is configurable.

Evidence: config-wiring.test.ts:125 — baseDelayMs: 10

Suggested fix: Either add an explicit baseDelayMs wiring test or
      add a comment noting the implicit coverage.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 1 | Duplicate defaults between Zod schema and destructuring; no integration test bridging the two |
| MEDIUM | 3 | Expiry buffer test proves direction not magnitude; 3 config values unwired-untested; URL resolution on every call |
| LOW | 2 | Duplicate types; accidental baseDelayMs coverage |

## Trend

The config wiring is mechanically correct — all six configurable values (maxAttempts, baseDelayMs, timeoutMs, maxRetryAfterSeconds, rating URL, token URL) plus tokenExpiryBufferSeconds are read from `this.config` with fallback defaults. The Zod schema has been hardened since the prior review (`.finite()`, `.max()` bounds, `.trim()` on credentials).

The main structural concern is the HIGH: two sources of defaults. The Zod schema says "maxAttempts defaults to 4" and the destructuring at line 43 also says "maxAttempts defaults to 4." These two numbers must be kept in sync manually. The provider works correctly whether it receives config from loadUpsConfig() (which fills Zod defaults) or from manual construction (which triggers destructuring defaults). But the two paths can silently diverge if either default is changed independently.

The test suite covers URL wiring and maxAttempts well but leaves three retry config values (baseDelayMs, timeoutMs, maxRetryAfterSeconds) without explicit wiring tests. The existing retry tests from http-retry.test.ts verify these values work at their defaults, but no test proves a custom config value takes effect.
