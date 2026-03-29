# Fresh Review — Spec and PRD Compliance

Date: 2026-03-29
Model: Codex
Scope: Full repository review against `spec.md` and `docs/PRD.md`

## Findings

### 1. High — The repository does not currently satisfy the TypeScript quality bar because both packages fail typecheck

The test suite passes, but the exported core package no longer typechecks. `@pidgeon/core` re-exports `Address`, `Weight`, and `RateRequest` as types at [`packages/core/src/index.ts:22`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L22), then uses those names later in the same file at [`packages/core/src/index.ts:39`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L39), [`packages/core/src/index.ts:58`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L58), and [`packages/core/src/index.ts:60`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L60), which TypeScript rejects because re-exporting does not create local bindings. `packages/core/src/cli.ts` also fails at [`packages/core/src/cli.ts:53`](/Users/mrkai/code/pidgeon/packages/core/src/cli.ts#L53) because `issue.path[0]` is typed broadly enough to include `symbol`, and the template-string interpolation is unsafe.

This matters beyond lint hygiene: the PRD explicitly requires strong TypeScript types and production-quality code, and the package cannot be considered cleanly consumable while `bun run --cwd packages/core typecheck` and `bun run --cwd packages/carrier-ups typecheck` both fail.

### 2. High — The shared HTTP layer required in `@pidgeon/core` still does not exist

The spec assigns the HTTP layer to core at [`spec.md:13`](/Users/mrkai/code/pidgeon/spec.md#L13) and defines shared responsibilities there at [`spec.md:63`](/Users/mrkai/code/pidgeon/spec.md#L63): retry, timeout handling, reactive 429 handling, sanitised logging, and structured error mapping. In the implementation, those concerns still live directly inside the UPS provider at [`packages/carrier-ups/src/rate.ts:70`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L70), [`packages/carrier-ups/src/rate.ts:92`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L92), [`packages/carrier-ups/src/rate.ts:136`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L136), and [`packages/carrier-ups/src/rate.ts:180`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L180).

This is still off-spec on an explicit architectural boundary. It works for a single UPS operation, but the first additional carrier or second operation will either duplicate transport logic or force refactoring of already-working provider code.

### 3. Medium — Aggregated multi-carrier failures still collapse structured errors into a string

The spec and PRD require meaningful, structured errors at the caller boundary in [`spec.md:49`](/Users/mrkai/code/pidgeon/spec.md#L49), [`spec.md:76`](/Users/mrkai/code/pidgeon/spec.md#L76), and [`docs/PRD.md:39`](/Users/mrkai/code/pidgeon/docs/PRD.md#L39). Individual carriers now return `CarrierError`, but the all-fail path in [`packages/core/src/index.ts:66`](/Users/mrkai/code/pidgeon/packages/core/src/index.ts#L66) still exposes `error: string`, and [`packages/core/src/registry.ts:48`](/Users/mrkai/code/pidgeon/packages/core/src/registry.ts#L48) synthesizes that string by joining carrier messages.

The `failures` array preserves structure, so this is not a total loss of information. But the primary error field at the aggregate boundary is still weaker than the documented contract.

### 4. Medium — The internal custom error-class layer described in the spec is still absent

The spec calls for internal custom error classes such as `CarrierAuthError`, `CarrierRateLimitError`, `CarrierNetworkError`, and `CarrierValidationError` at [`spec.md:77`](/Users/mrkai/code/pidgeon/spec.md#L77). A repository-wide search shows no such internal error classes; the implementation currently constructs plain `CarrierError` objects through `upsError()` in [`packages/carrier-ups/src/rate.ts:33`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L33).

This is a secondary design miss rather than an immediate runtime bug, but it does mean the implementation has not met the internal error-model architecture described in the spec.

## Verification

- `bun test` passes (`117` tests)
- `bun run --cwd packages/core typecheck` fails
- `bun run --cwd packages/carrier-ups typecheck` fails because it imports the broken core package
