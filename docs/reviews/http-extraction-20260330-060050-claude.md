# Adversarial Review: HTTP Transport Layer Extraction

- **Scope:** `packages/core/src/http.ts` (new), `packages/carrier-ups/src/rate.ts` (refactored), related exports
- **Commits:** `25ce7f8` (feat: shared HTTP transport layer), `9e83230` (refactor: UPS rate provider uses core HTTP transport)
- **Reviewer:** Claude Opus 4.6 (adversarial-reviewer agent)
- **Date:** 2026-03-30T06:00:50Z
- **Method:** Independent code inspection. No prior review reports consulted.

---

## HIGH

```
[HIGH] CORRECTNESS — parseErrorBody computes `message` but always returns null

  Where: packages/core/src/http.ts:68-79
  What: The function declares `let message: string | null = null` on line 69,
        never assigns it, and returns `{ raw, message }` — so `message` is
        always `null`. Every caller that destructures `message` gets nothing.
        The `bodyMessage` parameter in `mapStatusToError` is therefore always
        `null`, making the `detail` variable fall through to the
        `errorBodyParser` result or nothing.
  Why it matters: For any error status where the `errorBodyParser` is not
        provided (or returns null), the error message will never contain the
        actual response body text. The function looks like it was intended to
        extract a human-readable message from the JSON body but the
        implementation was never completed. This is a "paper guardrail" — the
        function exists but does not do what its signature promises.
  Evidence:
        Line 69: `let message: string | null = null;`
        Line 78: `return { raw, message };`  // always null
        Line 143: `const { raw } = await parseErrorBody(response, logger);`
        — callers don't even destructure `message`, confirming it's dead.
  Suggested fix: Either extract a message from the parsed JSON body (e.g.
        stringify it or pull a known field), or remove the `message` field
        from the return type entirely so no future caller is misled.
```

```
[HIGH] CORRECTNESS — Double timeout mechanism races with itself, can leak the abort timer path

  Where: packages/core/src/http.ts:106-136
  What: The code sets up an AbortController with `setTimeout` (line 107) AND
        a `Promise.race` with a manual abort listener (lines 119-125). When
        the timer fires, it calls `controller.abort()`, which triggers BOTH
        the fetch's internal abort handling AND the manual Promise that
        rejects with a new DOMException. If `fetch` itself handles AbortSignal
        natively (as it does in Bun/Node), the race has two rejection paths
        for the same event. The `clearTimeout` on line 127 only runs on the
        success path of the race — if the manual abort promise wins the race,
        the fetch promise is left dangling with no cleanup.
  Why it matters: In practice the duplicate mechanism is redundant and
        confusing but likely works because both rejection paths produce an
        AbortError that the catch block handles. However, the dangling fetch
        promise (when the manual abort promise wins) will eventually reject
        with an unhandled rejection if the runtime's fetch implementation
        also throws on abort after the race has settled.
  Evidence:
        Lines 107: `const timeoutId = setTimeout(() => controller.abort(), timeoutMs);`
        Lines 119-125: `Promise.race([config.fetch(...), new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => { reject(...) })
        })])`
  Suggested fix: Remove the manual abort promise from Promise.race. Just
        pass `signal: controller.signal` to fetch and let the native abort
        handling work. The catch block already handles AbortError correctly.
```

```
[HIGH] CORRECTNESS — Token endpoint has no retry, timeout, or backoff

  Where: packages/carrier-ups/src/rate.ts:213-257
  What: The `acquireToken` method uses raw `this.fetchFn()` directly (line
        219) instead of routing through `httpRequest()`. This means the token
        endpoint call has no timeout, no retry on transient failure, and no
        backoff. A slow or flaky token endpoint will hang indefinitely.
  Why it matters: In production, if the UPS OAuth endpoint returns a 500 or
        times out, the entire `getRates()` call fails immediately with no
        retry. The HTTP transport layer was extracted specifically to provide
        these guarantees, but the token acquisition path bypasses it entirely.
  Evidence:
        Line 219: `response = await this.fetchFn(this.tokenUrl, { ... })`
        Compare with line 97-110 which uses `httpRequest()` for the rating call.
  Suggested fix: Route token acquisition through `httpRequest()` or at
        minimum add a timeout via AbortController. If not using httpRequest
        (to avoid circular auth logic), document why and add at least a
        timeout.
```

---

## MEDIUM

```
[MEDIUM] TYPE SAFETY — Unsafe `as` casts on unknown API response with no runtime validation

  Where: packages/carrier-ups/src/rate.ts:128-140
  What: `mapResponse` casts `json as Record<string, unknown>` (line 128),
        then casts nested properties with `as Record<string, unknown>` and
        `as UpsRatedShipment[]` (line 140). The `UpsRatedShipment` type has
        required fields like `BillingWeight.Weight`, `TotalCharges.MonetaryValue`,
        etc. If UPS returns a shipment object missing these nested fields,
        the code will access `undefined.MonetaryValue` and throw a TypeError
        that is caught by the generic catch on line 198. The error message
        will be cryptic ("Cannot read properties of undefined") rather than
        identifying which field was missing.
  Why it matters: The `as UpsRatedShipment[]` cast on line 140 is the core
        of the problem — it tells TypeScript "trust me, this is the right
        shape" when the data comes from an external API. The project's
        CLAUDE.md says "unknown over any" and "Zod schemas... validated at
        service boundary," but this response parsing uses neither.
  Evidence:
        Line 128: `const envelope = json as Record<string, unknown> | null;`
        Line 140: `for (const shipment of ratedShipments as UpsRatedShipment[]) {`
  Suggested fix: Either validate with a Zod schema for the UPS response, or
        add explicit null checks for each nested field before accessing it
        (like the code already does for `TimeInTransit.ServiceSummary` on
        line 152-154, but not for `TotalCharges`, `BillingWeight`, etc.).
```

```
[MEDIUM] TYPE SAFETY — upsErrorBodyParser uses unsafe cast with no guard

  Where: packages/carrier-ups/src/rate.ts:37-44
  What: `const envelope = body as UpsErrorEnvelope | null;` casts unknown
        to a specific type without checking. If `body` is a string, number,
        or array, accessing `envelope?.response?.errors` won't crash (optional
        chaining saves it), but `body as UpsErrorEnvelope | null` when body
        is `"unparseable"` (the fallback from `parseErrorBody`) is misleading.
  Why it matters: This one is saved by optional chaining, so it's functional.
        But it sets a pattern where `as` casts on `unknown` are treated as
        safe, which they are not in general. Lower severity because it works
        in practice.
  Evidence: Line 38: `const envelope = body as UpsErrorEnvelope | null;`
  Suggested fix: Use a type guard or check `typeof body === 'object' && body !== null`
        before accessing properties.
```

```
[MEDIUM] CORRECTNESS — Token expiry race condition on concurrent calls

  Where: packages/carrier-ups/src/rate.ts:206-257
  What: `getToken()` checks `Date.now() < this.cachedToken.expiresAt` and
        returns the cached token, or calls `acquireToken()`. If two
        concurrent `getRates()` calls both see an expired token, both will
        call `acquireToken()` simultaneously, making two token requests. The
        second one overwrites `this.cachedToken` set by the first. This is
        a thundering herd / duplicate request problem.
  Why it matters: While Bun is single-threaded, the `await this.fetchFn()`
        in `acquireToken` yields, allowing a second `getRates()` call to
        enter `getToken()` before the first `acquireToken` resolves. In
        high-concurrency scenarios this means N simultaneous token requests
        instead of 1.
  Evidence:
        Lines 206-209: no lock or in-flight promise deduplication
        Lines 213-257: sets `this.cachedToken` only after fetch completes
  Suggested fix: Store the in-flight token promise and return it to
        concurrent callers. Standard pattern:
        `this.tokenPromise ??= this.acquireToken().finally(() => { this.tokenPromise = null; })`
```

```
[MEDIUM] API CONTRACT — Response parsing assumes TimeInTransit.ServiceSummary is a single object, but UPS Shop returns an array

  Where: packages/carrier-ups/src/rate.ts:152
  What: The code accesses `shipment.TimeInTransit?.ServiceSummary` as a
        single object. The UPS API reference shows ServiceSummary as a single
        object in the example, but the UPS Rating API OpenAPI spec (for
        `Shoptimeintransit` requestoption, which this code uses per line 66)
        can return ServiceSummary as either a single object or an array
        depending on the response. The internal type `UpsRatedShipment` on
        line 340 types it as a single object.
  Why it matters: If UPS ever returns ServiceSummary as an array (which the
        full OpenAPI spec allows), the code would fail to extract
        `EstimatedArrival` and return an error for every shipment.
  Evidence:
        Line 66: URL ends with `Shoptimeintransit`
        Line 152: `const timeInTransit = shipment.TimeInTransit?.ServiceSummary;`
        Type on line 341: `ServiceSummary: { Service: ... }` (not an array)
        docs/ups-api-reference.md line 275: "arrays that could be single objects"
        is listed as a known quirk.
  Suggested fix: Normalize ServiceSummary to always be an array before
        iterating. Check `Array.isArray(serviceSummary)` and handle both forms.
```

```
[MEDIUM] TEST QUALITY — No dedicated test file for the core HTTP transport layer

  Where: packages/core/src/ (missing http.test.ts)
  What: The `httpRequest` function in `@pidgeon/core` has no unit tests of
        its own. All testing is done indirectly through `UpsRateProvider` in
        `carrier-ups`. This means the HTTP layer's contract is only tested
        through one consumer.
  Why it matters: When a second carrier package (e.g., FedEx) is added and
        uses `httpRequest`, there are no core-level tests to guarantee its
        behavior independently of UPS-specific test fixtures. Bugs in the
        core HTTP layer could be masked by UPS-specific test setup. The
        `parseErrorBody` always-null-message bug (finding #1) would likely
        have been caught by a focused unit test.
  Evidence: `packages/core/src/` contains `cli.test.ts` and `registry.test.ts`
        but no `http.test.ts`.
  Suggested fix: Add a dedicated test file for `httpRequest` in
        `packages/core/src/http.test.ts` that tests retry, backoff, timeout,
        429 handling, and error mapping independently of any carrier.
```

```
[MEDIUM] CORRECTNESS — Retry-After header with HTTP-date format silently ignored

  Where: packages/core/src/http.ts:149-159
  What: The Retry-After header can be either a number of seconds or an
        HTTP-date (e.g., "Sat, 30 Mar 2026 12:00:00 GMT"). The code only
        handles the integer format via `parseInt`. If UPS sends an HTTP-date,
        `parseInt` returns `NaN`, the `if (!Number.isNaN(seconds))` check
        fails, and `retryAfterMs` stays at 0. The retry proceeds with only
        the exponential backoff delay.
  Why it matters: The server explicitly told the client when to retry, but
        the client ignores it and retries too soon. This could lead to
        repeated 429s and eventual failure.
  Evidence:
        Line 150: `const seconds = parseInt(retryAfter, 10);`
        Line 151: `if (!Number.isNaN(seconds)) {` — falls through for dates
  Suggested fix: Check if `parseInt` fails, then try `Date.parse(retryAfter)`
        and compute the delta from `Date.now()`.
```

---

## LOW

```
[LOW] CORRECTNESS — Logger message says "rating request" for all HTTP requests

  Where: packages/core/src/http.ts:103
  What: The generic HTTP transport layer logs `"rating request"` on line 103.
        This is carrier-specific language baked into a shared module. When a
        second carrier uses this function, logs will say "rating request" for
        label creation, tracking, etc.
  Why it matters: Misleading log messages in production make debugging harder.
  Evidence: Line 103: `logger?.info("rating request", { url: request.url, attempt });`
  Suggested fix: Use a generic message like `"http request"` or accept a
        label via the request config.
```

```
[LOW] SECURITY — btoa may produce incorrect encoding for credentials with special characters

  Where: packages/carrier-ups/src/rate.ts:221
  What: `btoa(`${clientId}:${clientSecret}`)` will throw if clientId or
        clientSecret contains characters outside the Latin-1 range. While UPS
        credentials are typically ASCII, the OAuth spec (RFC 6749 section
        2.3.1) requires the client_id and client_secret to be
        application/x-www-form-urlencoded before base64 encoding.
  Why it matters: If a client secret ever contains characters like `+`, `=`,
        or non-ASCII, the encoding will be wrong per spec, causing silent
        auth failures.
  Evidence: Line 221: `"Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`
  Suggested fix: URL-encode both clientId and clientSecret before
        concatenating and base64-encoding, per RFC 6749 section 2.3.1.
```

---

## Triage Recommendation

**Fix first (high-value, low-effort):**
- Finding 1 (parseErrorBody null message) — clear incomplete implementation
- Finding 3 (token endpoint no timeout) — production hang risk
- Finding 8 (missing http.test.ts) — would have caught finding 1; prevents regression as more carriers are added
- Finding 10 (hardcoded "rating request" log) — trivial fix

**Investigate before fixing:**
- Finding 2 (double timeout) — verify whether Bun's fetch actually leaks on the described path
- Finding 7 (ServiceSummary array) — verify against actual UPS API responses, not just the OpenAPI spec

**Accept risk for now:**
- Findings 4-5 (unsafe casts) — functional due to optional chaining; worth addressing when Zod response schemas are added
- Finding 6 (token thundering herd) — unlikely at current scale; standard fix when concurrency increases
- Finding 9 (Retry-After date format) — UPS typically sends integer seconds; worth a TODO
- Finding 11 (btoa encoding) — UPS credentials are ASCII in practice
