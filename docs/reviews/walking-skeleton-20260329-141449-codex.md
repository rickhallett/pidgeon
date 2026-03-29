# Adversarial Review

- Scope: `walking-skeleton`
- Model: `codex`
- Timestamp (UTC): `2026-03-29 14:14:49`
- Branch: `test/walking-skeleton`

## Findings

### 1. `getRates()` throws instead of returning `Result` errors

Severity: High

[`packages/carrier-ups/src/rate.ts:21`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L21) advertises `Promise<Result<RateQuote[]>>`, but the implementation never handles failure paths. It unconditionally parses JSON and dereferences `json.RateResponse.RatedShipment` at [`packages/carrier-ups/src/rate.ts:28`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L28) and [`packages/carrier-ups/src/rate.ts:29`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L29).

UPS error responses are shaped as `response.errors`, not `RateResponse` ([`docs/ups-api-reference.md:252`](/Users/mrkai/code/pidgeon/docs/ups-api-reference.md#L252)). That means ordinary failures like `401`, `429`, malformed JSON, or network errors will throw instead of returning `{ ok: false, error }`, which breaks the boundary contract defined in [`packages/core/src/index.ts:5`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L5).

### 2. The provider never builds a valid UPS rate request

Severity: High

[`packages/carrier-ups/src/rate.ts:54`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L54) returns `{}` from `buildRequestBody()`, and that exact body is POSTed at [`packages/carrier-ups/src/rate.ts:25`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L25).

UPS expects a nested `RateRequest` payload containing shipper, destination, payment, package, and service details ([`docs/ups-api-reference.md:48`](/Users/mrkai/code/pidgeon/docs/ups-api-reference.md#L48)). As written, every `RateRequest` input is ignored and all outbound requests are invalid. The current test does not inspect the fetch arguments, so this is completely untested ([`packages/carrier-ups/src/rate.test.ts:63`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.test.ts#L63)).

### 3. The happy path assumes `TimeInTransit` is always present

Severity: Medium

The mapper dereferences `TimeInTransit` for `serviceName`, `transitDays`, and `guaranteed` at [`packages/carrier-ups/src/rate.ts:34`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L34), [`packages/carrier-ups/src/rate.ts:37`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L37), and [`packages/carrier-ups/src/rate.ts:48`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L48).

The UPS reference notes that `TimeInTransit` requires `DeliveryTimeInformation` in the request ([`docs/ups-api-reference.md:279`](/Users/mrkai/code/pidgeon/docs/ups-api-reference.md#L279)), and the current request builder does not send that field. A successful rate response without `TimeInTransit` would therefore crash the supposed happy path.

## Verification

- Reviewed commit history from the initial commit through `HEAD`
- Ran `bun test` on `2026-03-29`; result: `1 pass, 0 fail`
- Inspected:
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
  - [`packages/carrier-ups/src/rate.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.test.ts)
  - [`packages/core/src/index.ts`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts)
  - [`docs/ups-api-reference.md`](/Users/mrkai/code/pidgeon/docs/ups-api-reference.md)
  - [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md)
  - [`BUILD_ORDER.md`](/Users/mrkai/code/pidgeon/BUILD_ORDER.md)
