[HIGH] A single provider exception still blows up the whole registry call

Where:
- `packages/core/src/registry.ts:31`
- `packages/core/src/registry.ts:38`
- `spec.md:78`

What:
`getRatesFromAll()` uses `Promise.all([...providers].map((p) => p.getRates(request)))`. If any provider rejects instead of returning `Result`, the whole `Promise.all()` rejects and the registry throws.

Why it matters:
The provider boundary in this repo is explicitly `Result<T>`, never throws. A multi-carrier aggregator should preserve that boundary rather than letting one misbehaving provider crash the full request. This is especially important because the registry is the extensibility layer for third-party implementations.

Evidence:
A direct probe with one provider throwing `new Error("boom")` and one healthy provider causes `getRatesFromAll()` itself to throw `"boom"` instead of returning a partial success or structured error.

Recommendation:
Wrap each provider call so rejections are converted into `{ ok: false, error }` before aggregation, and add a test covering one throwing provider alongside one healthy provider.

[MEDIUM] The new registry is not exposed through the package boundary

Where:
- `packages/core/package.json:6`
- `packages/core/src/index.ts:1`
- `packages/core/src/registry.test.ts:59`

What:
`@pidgeon/core` only exports `./src/index.ts`, and `src/index.ts` exports types only. `CarrierRegistry` lives in `src/registry.ts` and is only exercised by direct relative imports in the test file.

Why it matters:
Step 11 is supposed to establish the extension point for adding carriers. As implemented, consumers of the package cannot import the registry through the supported package entrypoint, so the refactor is still effectively internal-only.

Recommendation:
Export `CarrierRegistry` from the public entrypoint, or add an explicit subpath export if you want it to remain a distinct module.
