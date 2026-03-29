# Config Work Review

- Scope: `config-work`
- Model: `codex`
- Timestamp: `2026-03-29 18:05:11 UTC`
- Branch: `feature/config-extraction`
- Reviewed state: current working tree

## Findings

### High: The new config layer is not wired into the runtime path, so hardcoded values still control behavior

[`packages/carrier-ups/src/config.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.ts#L27) loads and validates credentials, retry policy, endpoint URLs, and token-expiry buffer, but [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L28) still hardcodes retry constants, [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L48) still hardcodes the rating URL, [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L219) still hardcodes the token URL, and [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L252) still hardcodes the 60-second token buffer.

That means the new configuration work does not currently affect the real provider behavior. BUILD_ORDER step 9 explicitly says to “extract hardcoded values into Zod-validated config” in [`BUILD_ORDER.md`](/Users/mrkai/code/pidgeon/BUILD_ORDER.md#L46), and the PRD says environment-specific values must not remain hardcoded in [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md#L33). The current tests only prove the loader in isolation, so this regression-to-no-op would ship cleanly.

### Medium: The package entrypoint does not export the config loader, so the new config API is not actually consumable through the package boundary

[`packages/carrier-ups/package.json`](/Users/mrkai/code/pidgeon/packages/carrier-ups/package.json#L6) exports only `./src/index.ts`, but [`packages/carrier-ups/src/index.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/index.ts#L1) exports nothing. `loadUpsConfig()` exists only as a file-local import target in [`packages/carrier-ups/src/config.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.test.ts#L2).

If this config module is meant to be the package’s supported configuration surface, consumers currently cannot import it from `@pidgeon/carrier-ups`. That makes the feature incomplete at the package boundary and hides the gap because the tests import the file directly instead of exercising the public API.

## Verification

- `bun test packages/carrier-ups/src/config.test.ts` -> `13 pass, 0 fail`
- Reviewed:
  - [`packages/carrier-ups/src/config.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.ts)
  - [`packages/carrier-ups/src/config.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.test.ts)
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
  - [`packages/carrier-ups/src/index.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/index.ts)
  - [`BUILD_ORDER.md`](/Users/mrkai/code/pidgeon/BUILD_ORDER.md)
  - [`docs/PRD.md`](/Users/mrkai/code/pidgeon/docs/PRD.md)
