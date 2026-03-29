# Fresh Spec/PRD Review

Date: 2026-03-29
Model: codex
Scope: fresh review of current working tree against `spec.md` and `docs/PRD.md`

## Findings

### 1. High — The core extension surface is still rate-only, so adding new operations would require rewriting shared code

**Where**
- `packages/core/src/index.ts:89`
- `spec.md:18`
- `spec.md:110`
- `docs/PRD.md:29`

**What**
`CarrierProvider` only declares `getRates(request)`. The spec explicitly called for a provider interface with `getRates()` plus optional future operations like `createLabel?()`, `validateAddress?()`, and `getTracking?()`.

**Why it matters**
This is the main architectural promise in both the spec and PRD: adding a second UPS operation should not require changing existing shared contracts. In the current shape, the first non-rating operation forces a change to the core interface and its downstream consumers.

**Recommendation**
Broaden the provider abstraction now, even if the extra methods are optional and unimplemented. That preserves the “extend without rewrite” boundary the documents promise.

### 2. Medium — Structured errors are still lost at the multi-carrier boundary when every carrier fails

**Where**
- `packages/core/src/index.ts:95`
- `packages/core/src/registry.ts:51`
- `docs/PRD.md:41`
- `spec.md:80`

**What**
Provider-level failures are structured `CarrierError`s, but `AggregatedRateResult` collapses total failure to `error: string`, and `CarrierRegistry.getRatesFromAll()` joins failure messages into one string when no quotes are returned.

**Why it matters**
The spec and PRD require meaningful, structured errors returned to callers. The registry keeps structure for partial success via `failures`, but loses it exactly when the caller most needs it: total failure across all carriers.

**Recommendation**
Return structured carrier failures on the all-failed path as well, either by reusing `failures` or by introducing a structured aggregate error shape.

### 3. High — The shared HTTP layer described in the spec still does not exist; transport concerns remain embedded in the UPS provider

**Where**
- `spec.md:13`
- `spec.md:63`
- `packages/carrier-ups/src/rate.ts:48`

**What**
The spec places config and an HTTP layer in `@pidgeon/core`, but retry policy, timeout handling, 429 handling, and HTTP error mapping all still live directly inside `UpsRateProvider`.

**Why it matters**
This is not just a cleanup opportunity; it is a direct miss against a named core responsibility in the spec. With retry, timeout, 429 handling, and HTTP error mapping still embedded in UPS code, the first additional carrier is likely to duplicate transport logic or force a late extraction that rewrites already-working code.

**Recommendation**
Extract the transport concerns behind a small reusable core HTTP helper before a second carrier or second UPS operation is added.

### 4. Medium — The repository still misses the required `README.md`

**Where**
- `docs/PRD.md:68`

**What**
There is now a root `.env.example`, but there is still no `README.md` in the repository root.

**Why it matters**
This is an explicit deliverable in the PRD. It also matters practically because the repo now has enough moving parts that setup, design decisions, and known follow-ups should be documented for the evaluator.

**Recommendation**
Add a minimal README covering architecture, package layout, environment variables, test/build commands, CLI usage, and deferred work.

## Verification

- `bun test` — pass (`109` tests)
- `bun run --cwd packages/core typecheck` — pass
- `bun run --cwd packages/carrier-ups typecheck` — pass

## Notes

This review is against the current working tree. Existing uncommitted files in `docs/reviews/` and the modified `bun.lock` were not changed by this review.
