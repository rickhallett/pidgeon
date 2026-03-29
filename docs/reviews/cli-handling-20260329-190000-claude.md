# Adversarial Review — CLI Rate Command (Step 10)

**Scope:** Unstaged changes on `feature/cli-rate-command` — `cli.ts`, `cli.test.ts` (10 tests), `CarrierProvider` addition to `index.ts`, Commander dependency
**Date:** 2026-03-29T19:00:00Z
**Model:** claude (claude-opus-4-6)
**Verdict:** 0 CRITICAL, 1 HIGH, 2 MEDIUM, 3 LOW

---

## HIGH

### [HIGH] CORRECTNESS — No validation of numeric CLI args; NaN propagates silently to the provider

```
Where: packages/core/src/cli.ts:48-53
What: The weight and dimension args are coerced via Number():

        weight: { value: Number(opts.weight), unit: opts.weightUnit },
        dimensions: {
          length: Number(opts.length),
          width: Number(opts.width),
          height: Number(opts.height),
          unit: opts.dimUnit,
        },

      Commander declares these as string options:
        .requiredOption("--weight <number>", "Package weight")

      The <number> in the description is documentation only — Commander
      does not parse or validate the type. A user who types:

        pidgeon rate --weight abc --length 10 ...

      gets Number("abc") = NaN. This NaN is passed directly to the
      provider as RateRequest.packages[0].weight.value = NaN.

      The provider will then JSON.stringify this into the UPS request
      body as: "Weight": "NaN"

      UPS will reject this with an opaque error, but the CLI gives no
      indication that the user provided an invalid number.

      Similarly: --length "", --width " ", --height "3e2" all produce
      surprising results (0, 0, 300 respectively).

Why it matters: The CLI is the user-facing boundary. Invalid input
      should be caught and reported here with a clear message, not
      passed through to an HTTP call that fails with a remote error.
      This is especially important because the spec says "Zod schemas
      in core, validated at service boundary before any external call"
      — the CLI IS the service boundary for user input.

Evidence:
      cli.ts:48 — Number(opts.weight) with no validation
      cli.ts:50-53 — Number(opts.length/width/height) with no validation
      No test asserts that non-numeric weight/dimensions are rejected.

Suggested fix: Validate after coercion:
      const weight = Number(opts.weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        deps.write("Error: --weight must be a positive number");
        return;
      }
      Same for length, width, height. Alternatively, add a Zod schema
      for RateRequest validation at this boundary.
```

---

## MEDIUM

### [MEDIUM] CORRECTNESS — Provider errors don't set a non-zero exit code

```
Where: packages/core/src/cli.ts:70-73
What: When the provider returns { ok: false }, the action writes
      the error message and returns:

        if (!result.ok) {
          deps.write(`Error: ${result.error}`);
          return;
        }

      But it does not call process.exit(1) or throw to signal failure.
      The program exits with code 0 (success).

      The test at cli.test.ts:209-233 ("sets non-zero exit code on
      provider failure") attempts to verify this, but it's actually
      testing a different thing: it overrides exitOverride a second
      time, which replaces the suppression from createProgram's own
      exitOverride. The test then catches the throw from Commander's
      exitOverride — but this throw happens during ARG PARSING failures,
      not during the provider's Result error path.

      Looking at the test more carefully:
        - It calls parseAsync(VALID_RATE_ARGS) — all required args present
        - Commander won't throw for valid args
        - The provider returns { ok: false }
        - The action writes the error and returns normally
        - exitCode is never set
        - The test asserts on the output text (line 232), not on exitCode

      So the test title says "sets non-zero exit code" but the test body
      only checks that the error text was written. The exitCode variable
      declared at line 216 is never asserted on.

Why it matters: A CLI that exits 0 on failure breaks scripting. Any
      caller using `pidgeon rate ... && next_step` will proceed even when
      the rate lookup failed.

Evidence:
      cli.ts:70-73 — writes error, returns (exit code 0)
      cli.test.ts:216 — exitCode declared but never asserted
      cli.test.ts:232 — asserts on text, not exit code

Suggested fix: Either (a) throw an error or call process.exit(1) in
      the error path, or (b) make the action return a status code and
      have the caller set process.exitCode. Then fix the test to assert
      exitCode !== 0.
```

### [MEDIUM] DESIGN — CarrierProvider type added to core's index.ts in uncommitted diff, but CLI lives in core

```
Where: packages/core/src/index.ts:62-66, packages/core/src/cli.ts:2
What: The diff adds CarrierProvider to @pidgeon/core:

        export type CarrierProvider = {
          getRates(request: RateRequest): Promise<Result<RateQuote[]>>;
        };

      The CLI module imports from "./index.js" which is the core package
      itself. This means the CLI (a presentation concern) lives inside
      @pidgeon/core (a domain/types package).

      BUILD_ORDER Step 11 says "Extract the carrier interface from the
      concrete UPS implementation." The CarrierProvider type is being
      added here at Step 10 as a side effect of needing a type for
      ProgramDeps. This is early extraction — the interface is designed
      against the CLI's needs, not extracted from working code.

      More concretely: UpsRateProvider doesn't implement CarrierProvider.
      There is no `implements` clause, no factory, and no test that
      verifies structural compatibility. The type exists only because
      the CLI test needs it for fakeProvider().

Why it matters: Two concerns:
      1. CLI in core creates a dependency pull — core now depends on
         Commander, but core is supposed to be the dependency-free types
         package that carrier packages import from.
      2. CarrierProvider was added a step early. It was supposed to be
         extracted from working code at Step 11, but it's being defined
         at Step 10 from the CLI's perspective.

Evidence:
      packages/core/package.json — "commander": "^14.0.3" in dependencies
      packages/core/src/cli.ts — imports from "./index.js"
      BUILD_ORDER.md:54-56 — Step 11 is "Extract the carrier interface"
      UpsRateProvider has no `implements CarrierProvider`

Suggested fix: Either:
      (a) Accept that CLI in core is a pragmatic choice and document it.
          The Commander dependency is lightweight and core is already
          the natural home for shared types + CLI entry point.
      (b) Move CLI to its own package (e.g., @pidgeon/cli) that depends
          on both @pidgeon/core and @pidgeon/carrier-ups.
      For CarrierProvider: verify UpsRateProvider structurally satisfies
      it (add a type-level test or implements clause at Step 11).
```

---

## LOW

### [LOW] TEST QUALITY — Transit days test is overly broad

```
Where: packages/core/src/cli.test.ts:140-153
What: The "displays transit days" test checks:

        expect(text).toContain("3");
        expect(text).toContain("2");

      The output text is:
        "UPS Ground  12.50 USD  3 day(s)"
        "UPS 2nd Day Air  28.75 USD  2 day(s) [Guaranteed]"

      Both "3" and "2" appear in many places besides transit days:
      - "12.50" contains no 3 or 2, but the service name "2nd Day"
        contains "2"
      - The price "28.75" contains "2"

      The test would pass even if transit days were omitted, because
      "2" appears in "UPS 2nd Day Air" and "28.75".

Why it matters: The test doesn't prove transit days are displayed.
      It proves the output contains the digits 2 and 3, which it
      would regardless.

Evidence: cli.test.ts:151 — expect(text).toContain("2") — passes
      because of "2nd Day Air" and "28.75"

Suggested fix: Assert on the formatted pattern:
      expect(text).toContain("3 day(s)");
      expect(text).toContain("2 day(s)");
```

### [LOW] DESIGN — Single-package limitation is implicit

```
Where: packages/core/src/cli.ts:46-57
What: The CLI always creates exactly one package in the request:

        packages: [
          {
            weight: { value: Number(opts.weight), unit: opts.weightUnit },
            dimensions: { ... },
          },
        ],

      There is no way to specify multiple packages. This is a reasonable
      MVP limitation, but it's undocumented and there's no flag like
      --packages or a message saying "single-package mode."

      A user with a multi-package shipment will get rates for only one
      package and not know why the price seems low.

Why it matters: Low risk for an MVP CLI, but worth noting. A comment
      or --help text clarification would suffice.

Evidence: cli.ts:46 — hardcoded single-element array

Suggested fix: Add to the rate command description:
      .description("Get shipping rate quotes (single package)")
      Or add a comment noting this is a known limitation.
```

### [LOW] TEST QUALITY — All tests use dynamic import; module caching may mask bugs

```
Where: packages/core/src/cli.test.ts:92, 125, 143, etc.
What: Every test uses:

        const { createProgram } = await import("./cli.js");

      In a module system, the first dynamic import loads the module;
      subsequent imports return the cached module. This means all 10
      tests share the same module instance.

      For a pure function like createProgram() this is fine — each
      call creates a new Command instance. But if cli.ts ever
      introduced module-level state (e.g., a singleton program),
      tests would share that state invisibly.

Why it matters: Not a bug today. The dynamic import is likely used to
      avoid top-level import of Commander at test time, which is
      reasonable. But the pattern is fragile if the module grows.

Evidence: 10 tests, all using await import("./cli.js")
      Module caching is the default behaviour in both Bun and Node.

Suggested fix: Either add a comment explaining the pattern, or use
      a top-level import since Commander is a normal dependency:
        import { createProgram } from "./cli.js";
```

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| CRITICAL | 0 | — |
| HIGH | 1 | No numeric validation on CLI args; NaN reaches the provider |
| MEDIUM | 2 | Exit code is 0 on provider failure; CLI + CarrierProvider in core one step early |
| LOW | 3 | Transit days test matches wrong text; single-package implicit; dynamic import pattern |

## Trend

The CLI implementation is clean and well-structured. The `createProgram(deps)` factory with injectable provider and write function is an excellent testing seam — it allows all tests to run in-process without subprocess spawning. The output formatting is readable and the `--json` flag is a thoughtful addition for scripting.

The main gap is input validation: the CLI is the outermost service boundary, and it passes `Number(opts.weight)` directly to the provider with no guard against NaN, negative values, or zero. Combined with the exit-code-is-always-0 issue, the CLI would silently "succeed" (exit 0) with an error message that a script might not read.

The `CarrierProvider` type being added here rather than at Step 11 is a minor sequence concern — it's structurally correct but doesn't yet have a verified connection to `UpsRateProvider`. The Commander dependency landing in `@pidgeon/core` is worth a conscious decision about whether core should remain dependency-free.
