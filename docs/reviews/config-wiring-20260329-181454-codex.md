# Config Wiring Review

- Scope: `config-wiring`
- Model: `codex`
- Timestamp: `2026-03-29 18:14:54 UTC`
- Branch: `feature/config-extraction`
- Reviewed state: current working tree

## Findings

### High: The validated config path is still optional, so invalid runtime config can bypass `loadUpsConfig()` entirely

[`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L23) still accepts raw `retry`, `urls`, and `tokenExpiryBufferSeconds` values directly on `UpsRateProviderConfig`, and [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts#L43) uses them without any validation at construction time. The new config loader in [`packages/carrier-ups/src/config.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.ts#L27) is therefore advisory rather than enforced.

Why it matters: the spec and build order describe Zod-validated config as the mechanism that should replace hardcoded values, but a caller can still instantiate `UpsRateProvider` with nonsense like `maxAttempts: 0`, negative timeouts, or malformed URLs and bypass that validation entirely. The new wiring tests construct the provider manually in [`packages/carrier-ups/src/config-wiring.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config-wiring.test.ts#L70), which proves the bypass path instead of closing it.

### Medium: The package boundary still does not expose a supported config-wired construction path

[`packages/carrier-ups/package.json`](/Users/mrkai/code/pidgeon/packages/carrier-ups/package.json#L6) exports only `./src/index.ts`, but [`packages/carrier-ups/src/index.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/index.ts#L1) exports nothing. So even though the runtime now reads configured URLs/retry/buffer when they are supplied, there is still no public package API that lets a consumer import `loadUpsConfig()` or a factory that combines validated config with `UpsRateProvider`.

Why it matters: this leaves the package with an internal-only config story. The tests pass by importing internal files directly, but a real consumer of `@pidgeon/carrier-ups` still has no supported way to use the new config work through the public boundary.

## Verification

- `bun test packages/carrier-ups/src/config-wiring.test.ts` -> `4 pass, 0 fail`
- Reviewed:
  - [`packages/carrier-ups/src/rate.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/rate.ts)
  - [`packages/carrier-ups/src/config.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config.ts)
  - [`packages/carrier-ups/src/config-wiring.test.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/config-wiring.test.ts)
  - [`packages/carrier-ups/src/index.ts`](/Users/mrkai/code/pidgeon/packages/carrier-ups/src/index.ts)
