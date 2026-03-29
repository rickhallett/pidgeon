# Adversarial Review

- Scope: `latest-tests`
- Model: `codex`
- Timestamp (UTC): `2026-03-29 16:14:54`
- Branch: `test/walking-skeleton`

## Findings

### 1. Tests still do not verify the outbound UPS request contract

Severity: High

The suite stubs `fetch` but never inspects the URL, headers, or body in either the happy-path test or the error-path tests. See [`packages/carrier-ups/src/rate.test.ts:63`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.test.ts#L63) and [`packages/carrier-ups/src/rate-errors.test.ts:41`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts#L41).

That leaves a major blind spot because [`packages/carrier-ups/src/rate.ts:129`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L129) still returns `{}` from `buildRequestBody()`. The tests can all pass while the integration sends an invalid UPS request for every input.

### 2. Several malformed-response tests are too weak to lock down error behavior

Severity: Medium

The tests for empty JSON, missing `RatedShipment`, and unparseable money only assert that some error exists. See [`packages/carrier-ups/src/rate-errors.test.ts:220`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts#L220), [`packages/carrier-ups/src/rate-errors.test.ts:235`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts#L235), and [`packages/carrier-ups/src/rate-errors.test.ts:255`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts#L255).

An implementation that collapses every malformed response into a generic `"error"` string would still pass. That means these tests do not actually verify the stated goal of meaningful boundary errors.

### 3. The suite misses the most likely successful-response crash path: no `TimeInTransit`

Severity: Medium

[`packages/carrier-ups/src/rate.ts:100`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L100) dereferences `shipment.TimeInTransit.ServiceSummary.EstimatedArrival.BusinessDaysInTransit` unconditionally, and also uses `TimeInTransit` for `serviceName` and `guaranteed` at [`packages/carrier-ups/src/rate.ts:108`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L108) and [`packages/carrier-ups/src/rate.ts:122`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L122).

UPS documents that `TimeInTransit` requires `DeliveryTimeInformation` in the request. There is no test for a `200 OK` rate payload that omits `TimeInTransit`, so the suite would not catch this crash even though the current request builder does not send that request field.

## Verification

- Ran `bun test`; result: `14 pass, 0 fail`
- Reviewed:
  - [`packages/carrier-ups/src/rate.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.test.ts)
  - [`packages/carrier-ups/src/rate-errors.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts)
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
- Scope note: this review covers the current working tree, not only committed history. [`packages/carrier-ups/src/rate-errors.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts) is currently untracked.
