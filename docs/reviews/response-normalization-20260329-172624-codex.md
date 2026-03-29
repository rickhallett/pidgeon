# Response Normalization Review

- Scope: `response-normalization`
- Model: `codex`
- Timestamp: `2026-03-29 17:26:24 UTC`
- Branch: `feature/response-normalization`
- Reviewed state: current working tree

## Findings

### Medium: Missing `GuaranteedIndicator` is currently normalized as `true`

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L144) sets `guaranteed` using `timeInTransit.GuaranteedIndicator !== ""`. If UPS omits that field entirely, `undefined !== ""` evaluates to `true`, so a shipment with no guarantee indicator is misclassified as guaranteed.

The new suite only covers the explicit `"Y"` and `""` cases in [`packages/carrier-ups/src/response-normalization.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/response-normalization.test.ts#L161), so this bug would pass cleanly.

Recommendation: treat guarantee as true only for explicitly recognized truthy values, and add a normalization test for a missing indicator.

### Medium: Numeric normalization is still too permissive for partially malformed upstream values

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L101), [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L106), and [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L116) use `parseFloat` / `parseInt`. Those functions accept partial strings such as `"12.36 USD"` or `"2 business days"` and silently coerce them into valid-looking numbers.

The ten response-normalization tests only use clean numeric strings in [`packages/carrier-ups/src/response-normalization.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/response-normalization.test.ts), so they do not lock down exact numeric validation at the mapper boundary.

Recommendation: validate that these fields are strictly numeric before coercion, and add at least one test proving malformed mixed-content strings are rejected.

## Notes

The new test file is otherwise pointed in the right direction: it is intent-focused and checks normalized library output rather than pinning exact UPS payload shape.

## Verification

- `bun test packages/carrier-ups/src/response-normalization.test.ts` -> `10 pass, 0 fail`
- Reviewed:
  - [`packages/carrier-ups/src/response-normalization.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/response-normalization.test.ts)
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
  - [`packages/carrier-ups/src/rate-errors.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate-errors.test.ts)
