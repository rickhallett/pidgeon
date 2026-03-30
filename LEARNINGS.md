# Personal Learning Log

This log captures the architectural insights and meta-learnings from the development of *Pidgeon*.

## Technical Takeaways
*   **Prioritize Error Boundaries (Result<T> Pattern):** Implementing explicit `Result` types at the boundary of external API calls *before* the happy-path logic prevents cascading failures and forces exhaustive error handling.
*   **Single Source of Truth (Zod + TypeScript):** Use `z.infer` extensively to bridge validation and types. This eliminates drift between runtime API shapes and internal domain models.
*   **Capability-Based Decomposition:** Moving from monolithic providers to small, focused modules (e.g., separating token management from rate calculation) significantly improved testability and maintainability.
*   **Discriminated Unions for Domain Models:** Using TypeScript’s discriminated unions for errors and domain states enables compiler-enforced handling of all possible system states.

## Meta-Learnings (Development Process)
*   **Adversarial Review as a Force Multiplier:** Invoking independent reviews (e.g., alternating between Claude, Gemini, and Codex) throughout the implementation phase surfaced "blind spots" that single-agent development would have missed.
*   **Decision Logging (devlog.yml):** Maintaining a machine-queryable `devlog.yml` proved critical for tracking *why* architectural decisions were made, allowing the team (and AI agents) to revisit rationales without context loss.
*   **Outside-In TDD:** Starting with the external interface/cli and working inward ensured that the core architecture was always guided by real usage requirements rather than abstract assumptions.
*   **Iterative Refinement vs. Perfection:** The project demonstrated that refactoring a "God class" *after* it has been tested is often cleaner and more efficient than trying to design the perfect abstraction upfront.

## Git History Review Takeaways

From reviewing the full history from spec -> build plan -> implementation -> adversarial reviews -> review feedback, these were the biggest takeaways:

- Keep the plan as a live control document, not a reconstruction artifact. The most important sequencing change in the project was moving the error boundary ahead of request/response deepening; that was the right call, but `BUILD_ORDER.md` should have been updated at the moment of the decision, not at the end.
- Outside-in TDD was directionally correct, but the proof mattered almost as much as the code. The walking skeleton exposed integration seams early, yet several major steps collapsed red and green into single commits, which weakened the repository's claim that tests truly drove the work.
- Independent cross-family review was the highest-leverage part of the exercise. The strongest course corrections came from issues multiple reviewers found separately: the missing error boundary, auth retry semantics, registry failure attribution, config wiring gaps, and later HTTP extraction bugs.
- Reviews were most useful when they changed build order or architecture, not just code. The early review pressure showed that a broken boundary makes every later feature less trustworthy; fixing the container before deepening the feature set was a better move than following the original sequence rigidly.
- "Spec compliance" can be paper-thin if the behavior is not wired end to end. Several fixes initially existed only as types, interfaces, or docs until later passes connected them to runtime behavior and tests: structured errors, logger usage, schema-derived types, and CLI JSON output were all examples.
- Regression tests need to land in the same feedback cycle as the fix whenever possible. A recurring weakness in the history was implementation-first review remediation followed by coverage commits later, which made the causal chain harder to trust even when the final code was correct.
- If commit history is part of the deliverable, atomicity is not optional. Mixed-purpose commits made it harder to audit why something changed, whether it was code or process work, and which review finding actually caused the change.
- Refactoring after the main build surfaced a different class of truth. Once the HTTP layer and UPS internals were extracted into clearer modules, hidden mismatches became obvious, including token-flow duplication, transport boundary leaks, and UPS unit-code assumptions that had previously passed unnoticed.
- Triage added more value than raw review volume. The useful pattern was: collect independent reviews, identify consensus and severity, decide what to fix now vs defer, and record why. Without that filter, more review output would mostly have produced more noise.
- The meta lesson: process claims should be slightly more conservative than the code quality itself. The implementation ended in a stronger state than the initial drafts, but the history shows that rigor is easier to state than to preserve. Next time, I would optimise not just for correctness, but for preserving evidence of correctness as the work happens.

## AI-Assisted Development Patterns

These are structural observations about how AI-operator collaboration actually worked across the full build, not specific to shipping APIs.

### The operator's real job is triage, not coding

Across ~70 commits and 48 review documents, the AI did most of the writing (implementation, tests, reviews, docs). The operator's highest-value actions were: reordering the build plan after reviews (D015), deciding which review findings to fix vs defer, choosing when to stop reviewing and start refactoring, and catching when "spec compliance" was nominal rather than behavioral. The bottleneck was never code production — it was deciding what to do next and whether what was produced actually met the bar. The ratio of decision quality to output volume matters more than throughput.

### Velocity outpaces verification by default

AI writes code fast. Reviews find issues fast. But the human bottleneck is *deciding what to do about findings* — triage, prioritization, sequencing. The stowaway commits, the TDD gaps on foundational steps, and the implementation-first review remediation block all trace to the same root: the operator was overwhelmed by throughput. The fix is not "slow down" but "build in forced pauses between roles." Commit the triage doc. Then switch to coder. Then commit the code. The pause between roles is where quality lives.

### Fresh context beats accumulated context

The most valuable adversarial reviews were the early ones that started from scratch against the code. Later review rounds found fewer critical issues partly because the models had absorbed so much prior context they were anchored by it. The CLAUDE.md guidance about starting fresh sessions proved prescient. In practice: the first cross-family review of a new slice is worth roughly 10x the third review of the same slice. Front-load review investment at architectural boundaries, scale back as code stabilizes.

### The AI doesn't know what it doesn't know — and neither does the operator

The spec running ahead of implementation was invisible until cross-family reviews caught it. The operator approved commits that looked correct (types compiled, tests passed against stubs) but had untested behavioral paths. `Result<T>` was decorative for several commits before the error boundary existed. The credentials config created a false impression that auth was wired up. Trust-but-verify is the only viable mode, and "verify" means a test that exercises the actual path, not a type signature that describes intent.

### Process claims are easy to make and hard to sustain at machine speed

CLAUDE.md contains detailed process rules: atomic commits, TDD discipline, never work on main, separate agent responsibilities. The meta-review found partial compliance. The gap is not ignorance — it is that maintaining process discipline requires constant friction against the natural tendency (human and AI alike) to just ship the next thing. Writing the rules took an hour; following them under pressure across 70 commits over 7 hours proved harder. Future iterations should either simplify the rules to what can actually be sustained, or build mechanical enforcement (pre-commit hooks, CI checks) rather than relying on discipline.

### The decision record outlasts the code

For the take-home assessment that motivated this project, the code is table stakes. What differentiates is the reasoning: why bun over pnpm, why discriminated unions over classes, why outside-in over bottom-up, why this field set on RateQuote. The devlog entries cost minutes each. Their absence would cost a reviewer's trust in whether choices were deliberate. In a team context, the same principle applies: the next engineer who touches this code will care more about *why the error boundary was moved to before request building* than about the specific try/catch syntax. A devlog entry is an investment in future context that compounds; code without it is a black box that decays.

### Extraction is riskier than greenfield — treat it as a rewrite

The HTTP layer extraction from carrier-ups to core introduced 3 bugs despite having a full test suite: `parseErrorBody` silently lost its message extraction, a UPS-specific log label was copied into a generic module, and Retry-After HTTP-date parsing was missed. All were caught by tests, but all shipped in the initial "feat" commit. The failure mode is assuming extraction is mechanical (just moving lines). It is not — extraction changes context, and context changes correctness. Write the target interface first, then implement by referencing the old code, not by moving it.
