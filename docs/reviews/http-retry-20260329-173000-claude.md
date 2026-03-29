# Adversarial Review — HTTP Retry, Backoff & Timeout

**Scope:** Uncommitted changes on `feature/http-retry` — retry loop in `getRates()`, `http-retry.test.ts` (16 tests)
**Date:** 2026-03-29T17:30:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 1 CRITICAL, 2 HIGH, 3 MEDIUM, 3 LOW

---

## CRITICAL

### [CRITICAL] CORRECTNESS — Timeout aborts are not retried; every other transient failure is

```
Where: packages/carrier-ups/src/rate.ts:66-67
What: When the fetch times out (AbortError from the controller), the
      handler immediately returns:

        if (error instanceof DOMException && error.name === "AbortError") {
          return { ok: false, error: "Request timeout" };
        }

      This is a hard return — it exits the retry loop. Every other
      transient failure (network error, 500, 502, 503, 429) sets
      lastResult and continues to the next attempt.

      A timeout is a transient failure. The UPS server may have been
      momentarily slow. The next attempt, with a fresh timeout window,
      might succeed. But the code treats timeout as terminal.

Why it matters: Under load or transient latency (network jitter, UPS
      server GC pause), a single slow response kills the entire request
      with no retry. Meanwhile, a complete network failure (TypeError)
      gets 3 retries. This inverts the severity: the more likely
      transient failure (slow response) is treated worse than the less
      likely one (DNS failure).

Evidence:
      rate.ts:66-67 — return on AbortError (exits loop)
      rate.ts:69-70 — continue on network error (retries)
      rate.ts:91-93 — continue on 5xx (retries)
      http-retry.test.ts:331-362 — timeout test expects failure, not retry

Suggested fix: Change the AbortError handler to set lastResult and
      continue, matching the network error path:
        if (error instanceof DOMException && error.name === "AbortError") {
          lastResult = { ok: false, error: "Request timeout" };
          continue;
        }
      Update the timeout test to verify retry behaviour. The test at
      line 331 currently stubs a 30-second hang — it should verify that
      multiple attempts are made before giving up.
```

---

## HIGH

### [HIGH] CORRECTNESS — Promise.race with abort listener creates a memory/timer leak on success

```
Where: packages/carrier-ups/src/rate.ts:47-62
What: The timeout mechanism uses Promise.race between the fetch call
      and an abort-listener promise:

        response = await Promise.race([
          this.config.fetch(url, { ... signal: controller.signal }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new DOMException(...));
            });
          }),
        ]);
        clearTimeout(timeoutId);

      When fetch succeeds before the timeout:
      1. clearTimeout(timeoutId) cancels the timer — good.
      2. But the second promise (the abort listener) is never resolved
         or rejected. It has an event listener attached to
         controller.signal that is never removed.
      3. The AbortController, its signal, and the listener closure are
         retained until garbage collection.

      Over 4 retry attempts per getRates() call, this creates up to 4
      orphaned promises and listeners per request. Under high throughput,
      this is a slow memory leak.

      More critically: if controller.abort() is ALREADY called before
      the fetch resolves (a race between clearTimeout and the timer
      callback), the abort listener fires and rejects a promise that
      nobody is awaiting. This is an unhandled promise rejection in
      some environments.

Why it matters: Memory leak under sustained load. Potential unhandled
      promise rejection in edge cases.

Evidence: rate.ts:57-61 — addEventListener with no removeEventListener.
      The abort promise is never settled on the success path.

Suggested fix: The signal + fetch already handles abort natively. The
      Promise.race with a manual abort listener is redundant — fetch
      implementations (including Bun's) reject with AbortError when the
      signal is aborted. Simplify to:

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await this.config.fetch(url, {
            ...options,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

      This eliminates the orphaned promise entirely.
```

### [HIGH] CORRECTNESS — handleHttpError consumes the response body, making it unavailable on retry

```
Where: packages/carrier-ups/src/rate.ts:87, 92, 111-136
What: On 429 and 5xx, the code calls:
        lastResult = await this.handleHttpError(response);

      handleHttpError (line 111) calls response.json() to extract the
      UPS error message. Response bodies in the Fetch API are one-shot
      streams — once read, they cannot be read again.

      This is correct for the current code because handleHttpError is
      called once per response. But consider: if the retry loop were
      ever refactored to re-examine the response after handleHttpError
      (e.g., to extract Retry-After from the body, or to log the full
      response), the body would already be consumed.

      More immediately: if response.json() in handleHttpError throws
      (line 116, caught at line 121), the UPS error message is empty.
      The test stubs (serverError helper, line 102) return plain text
      bodies for 500/502/503. When handleHttpError tries to parse
      "Server Error" as JSON, it silently fails. The error message
      becomes "UPS HTTP error (500)" with no UPS-specific detail.

      This is technically correct but the test doesn't verify the
      error message content — it only checks result.ok is false and
      the call count. The test doesn't know whether handleHttpError
      extracted anything useful.

Why it matters: The server error tests (lines 140-177) verify retry
      behaviour but not error message quality. If handleHttpError were
      broken for plain-text bodies, the tests would still pass.

Evidence:
      serverError helper (line 102): Content-Type text/plain
      handleHttpError (line 116): response.json() — fails on text/plain
      Tests: no assertion on result.error content for retry scenarios

Suggested fix: Add assertions on the final error message in the
      "gives up after max retry attempts" test. Verify it contains
      the status code at minimum. This closes the "Right Answer,
      Wrong Work" gap.
```

---

## MEDIUM

### [MEDIUM] CORRECTNESS — Retry-After header with HTTP-date format is silently ignored

```
Where: packages/carrier-ups/src/rate.ts:77-85
What: The Retry-After header, per RFC 7231, can be either:
      - A number of seconds: "30"
      - An HTTP-date: "Sun, 29 Mar 2026 17:30:00 GMT"

      The code parses with parseInt(retryAfter, 10). For a date string,
      parseInt returns NaN. The isNaN check causes the code to skip
      setting retryAfterMs entirely — the 429 is retried with only
      the exponential backoff delay, ignoring the server's instruction.

Why it matters: If UPS sends Retry-After as an HTTP-date (which is
      valid per the RFC), the code retries too aggressively, potentially
      worsening the rate limiting situation.

Evidence: rate.ts:79 — parseInt(retryAfter, 10)
      No test for HTTP-date format Retry-After.

Suggested fix: Check if parseInt returns NaN, then try parsing as a
      Date:
        const date = new Date(retryAfter);
        if (!isNaN(date.getTime())) {
          retryAfterMs = Math.max(0, date.getTime() - Date.now());
        }
      Alternatively, document that only integer Retry-After is supported
      and add a test confirming the fallback behaviour.
```

### [MEDIUM] CORRECTNESS — Negative or zero Retry-After is treated as "no delay"

```
Where: packages/carrier-ups/src/rate.ts:79-84
What: If Retry-After is "0" or a negative string like "-5":
      - parseInt("0", 10) = 0 → not NaN → passes
      - 0 > maxRetryAfterSeconds (5) → false → skips the "give up" branch
      - retryAfterMs = 0 * 1000 = 0
      - Math.max(backoff, 0) = backoff → no additional delay

      This is probably correct (server says retry immediately), but the
      negative case is problematic:
      - parseInt("-5", 10) = -5 → not NaN → passes
      - -5 > 5 → false → continues
      - retryAfterMs = -5000
      - Math.max(backoff, -5000) = backoff → no additional delay

      The negative value doesn't cause harm (Math.max absorbs it), but
      it's an untested edge case.

Why it matters: Low practical risk but demonstrates that the Retry-After
      parsing trusts the header value without clamping.

Evidence: rate.ts:84 — retryAfterMs = seconds * 1000 (no clamp to >= 0)
      rate.ts:38 — Math.max(backoff, retryAfterMs) saves it

Suggested fix: Clamp seconds to >= 0 before multiplication. Add a test
      for Retry-After: "0" to document immediate-retry behaviour.
```

### [MEDIUM] TEST QUALITY — Backoff timing test is timing-sensitive and fragile

```
Where: packages/carrier-ups/src/http-retry.test.ts:232-252
What: The test verifies exponential backoff by comparing wall-clock
      timestamps between retry attempts:

        const firstGap = timestamps[1]! - timestamps[0]!;
        const secondGap = timestamps[2]! - timestamps[1]!;
        expect(secondGap).toBeGreaterThan(firstGap);

      With baseDelayMs=200:
      - First retry: 200ms delay → firstGap ≈ 200ms
      - Second retry: 400ms delay → secondGap ≈ 400ms

      On a loaded CI machine, the first gap could be 250ms (200ms delay
      + 50ms execution jitter) and the second gap could be 380ms (400ms
      delay - 20ms timer undershoot). The test would fail because
      380 < 250 is false... wait, 380 > 250 is true. But more extreme
      jitter could cause failure.

      The test also takes ~600ms of real wall-clock time (200 + 400ms
      backoff). Across the full suite, the retry tests contribute
      significantly to the 15-second runtime.

Why it matters: Timing-based tests are inherently flaky. The test
      verifies backoff is increasing but doesn't verify the actual
      delay values. A base delay of 200ms vs 201ms would both pass.

Evidence: Total suite time: 15.26s (up from ~1.2s before retry tests)
      http-retry.test.ts:250 — secondGap > firstGap (relative, not absolute)

Suggested fix: Consider injecting a mock delay function instead of
      using real setTimeout. This would make tests instant and
      deterministic. Alternatively, assert minimum delays with generous
      tolerance:
        expect(firstGap).toBeGreaterThanOrEqual(150); // 200ms - tolerance
        expect(secondGap).toBeGreaterThanOrEqual(300); // 400ms - tolerance
```

---

## LOW

### [LOW] CORRECTNESS — JSON parse failure on response body is not retried

```
Where: packages/carrier-ups/src/rate.ts:100-104
What: If the UPS response is HTTP 200 but the body fails JSON.parse
      (e.g., truncated response due to network interruption), the code
      returns immediately:

        return { ok: false, error: "Failed to parse UPS response as JSON" };

      This is not retried. A truncated response is a transient failure
      that could succeed on the next attempt.

Why it matters: Low likelihood — HTTP 200 with corrupt body is rare.
      But it's inconsistent: a network error that prevents the response
      entirely is retried, but a network error that corrupts the
      response body is terminal.

Evidence: rate.ts:102-103 — return (not continue)
      No test for this scenario.

Suggested fix: Consider changing to lastResult = { ... }; continue;
      Or document the choice as intentional (corrupt 200 is treated as
      a non-transient error).
```

### [LOW] DESIGN — Retry configuration is hardcoded, not injectable

```
Where: packages/carrier-ups/src/rate.ts:28-31
What: maxAttempts, baseDelayMs, timeoutMs, and maxRetryAfterSeconds are
      hardcoded as local constants inside getRates().

      BUILD_ORDER step 9 (Config) says: "Extract hardcoded values into
      Zod-validated config. Comes late because now we know what actually
      needs configuring."

      This finding is expected at this stage — the values are now known
      and should be extracted in step 9.

Evidence: rate.ts:28-31 — four hardcoded constants

Suggested fix: Defer to BUILD_ORDER step 9. Note: the values chosen
      (4 attempts, 200ms base, 3s timeout, 5s max retry-after) are
      reasonable for a shipping rate API.
```

### [LOW] TEST QUALITY — Timeout test takes ~3 seconds of real time

```
Where: packages/carrier-ups/src/http-retry.test.ts:331-362
What: The test stubs a 30-second hang and expects the code to time out
      within 15 seconds. With timeoutMs=3000 in the implementation, the
      test actually completes in ~3 seconds.

      The assertion expect(elapsed).toBeLessThan(15_000) is very loose —
      a timeout at 3s should be asserted closer to 3s, not 15s. The
      15s tolerance is so wide it would pass even if the timeout
      mechanism were broken and something else killed the request.

Evidence: rate.ts:30 — timeoutMs = 3_000
      http-retry.test.ts:360 — expect(elapsed).toBeLessThan(15_000)
      15_000 is 5x the actual timeout.

Suggested fix: Tighten to expect(elapsed).toBeLessThan(5_000) and
      expect(elapsed).toBeGreaterThanOrEqual(2_500) to bracket the
      expected ~3s timeout.
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 1 | Timeout (the most common transient failure) is the only one not retried |
| HIGH | 2 | Promise.race creates orphaned listeners; response body consumed before retry decision is fully tested |
| MEDIUM | 3 | HTTP-date Retry-After ignored; negative Retry-After untested; timing-sensitive backoff test |
| LOW | 3 | Corrupt 200 body not retried; hardcoded config (expected); loose timeout assertion |

## Trend

The retry loop is structurally sound — it correctly identifies 429 and 5xx as retriable, falls through to the error handler for 4xx, and uses exponential backoff with Retry-After as a minimum delay floor. The `maxRetryAfterSeconds` cap (line 81) is a good defensive measure against abusive Retry-After values.

The CRITICAL finding (timeout not retried) is an oversight with real production impact. Timeouts are the most common transient failure in HTTP integrations — network latency spikes, server-side GC pauses, TLS handshake delays. The current code retries on network errors (which are rarer and more likely to be persistent) but not on timeouts (which are more common and more likely to be transient). This inverts the retry priority.

The Promise.race pattern (HIGH) is an over-engineering of timeout handling. Bun's fetch natively respects `AbortSignal` — passing `signal: controller.signal` to fetch and calling `controller.abort()` from a setTimeout is sufficient. The manual abort-listener promise is redundant and creates lifecycle problems.

The test suite is well-designed — the `sequenceFetch` pattern with stateful response sequences cleanly tests retry behaviour without coupling to implementation details. The timing-sensitive tests are the main fragility concern.
