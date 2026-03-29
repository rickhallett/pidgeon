# OAuth Integration Review

- Scope: `oauth-integration`
- Model: `codex`
- Timestamp: `2026-03-29 17:01:04 UTC`
- Branch: `feature/ups-auth-lifecycle`
- Reviewed state: current working tree

## Findings

### High: Expiry is not transparently handled once a cached token has been selected

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L24) fetches a token once per `getRates()` call, but a downstream `401` from the rating request is treated as a terminal auth failure at [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L73). There is no cache invalidation or one-time re-acquisition path if the token expires between `getToken()` and the actual API call.

Why it matters: the repo requirements say expiry refresh should be transparent to callers in [`spec.md`](/Users/mrkai/code/pidgeon/spec.md#L53) and [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md#L25). Right now, a timing race still leaks an auth failure through the provider boundary.

Recommendation: on a `401` from the rating endpoint, clear the cached token and retry the request once with a freshly acquired token.

### Medium: Concurrent requests can stampede the token endpoint

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L153) only checks for an already-cached token. If several `getRates()` calls start while the cache is empty, each caller falls through to [`acquireToken()`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L160) independently.

Why it matters: this creates duplicate auth traffic and raises the risk of self-inflicted auth throttling under load. The current tests only prove sequential reuse in [`packages/carrier-ups/src/auth.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/auth.test.ts#L165), not shared in-flight acquisition.

Recommendation: memoize the in-flight token request so concurrent callers await the same promise.

### Medium: OAuth host selection is hardcoded into library code

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L165) always calls `https://onlinetools.ups.com/security/v1/oauth/token`. The repo requirements explicitly say environment-specific values should live in configuration rather than code in [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md#L33).

Why it matters: switching between CIE and production, or responding to an upstream host change, currently requires a code change instead of an ops/config change.

Recommendation: move base URLs into configuration and derive both token and rating endpoints from that configured environment.

## Verification

- `bun test packages/carrier-ups/src/auth.test.ts` -> `10 pass, 0 fail`
- Reviewed:
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
  - [`packages/carrier-ups/src/auth.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/auth.test.ts)
  - [`spec.md`](/Users/mrkai/code/pidgeon/spec.md)
  - [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md)
