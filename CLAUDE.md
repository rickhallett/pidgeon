# Pidgeon

Multi-carrier shipping integration service. TypeScript, bun workspaces, outside-in TDD.

## Standing Orders

- **Truth first** — truth over what the operator wants to hear.
- **Readback** — confirm understanding before acting when ambiguity or blast radius is non-trivial.
- **Gate** — change is ready only when `bun test` is green. Fail means not ready.
- **No git stash** — forbidden. Use a branch.
- **No interactive git** — no `git rebase -i`, no `git commit` without `-m`. Use `GIT_EDITOR=true` if needed.
- **Atomic commits** — one concern per commit. Stowaway changes are a code smell.
- **TDD discipline** — no implementation without a failing test demanding it. Red → green → refactor.

## Project Structure

```
pidgeon/
├── packages/
│   ├── core/          # @pidgeon/core — types, validation, config, errors, HTTP, carrier interface
│   └── carrier-ups/   # @pidgeon/carrier-ups — UPS OAuth, rate mapping, normalisation
├── docs/              # API reference, architecture notes
├── spec.md            # Full specification
├── devlog.yml         # Decision log (machine-queryable)
├── BUILD_ORDER.md     # Outside-in build sequence
└── CLAUDE.md          # This file
```

## Development

```bash
bun install            # Install deps
bun test               # Run all tests
bun run build          # Build all packages
```

## Key Files

| Task | Start at |
|------|----------|
| Spec | `spec.md` |
| Decisions | `devlog.yml` |
| Build sequence | `BUILD_ORDER.md` |
| UPS API shapes | `docs/ups-api-reference.md` |

## Agents

| Agent | File | Purpose |
|-------|------|---------|
| implementer | `.claude/agents/implementer.md` | Writes production code to satisfy failing tests |
| test-designer | `.claude/agents/test-designer.md` | Designs tests, evaluates coverage, validates test quality |
| adversarial-reviewer | `.claude/agents/adversarial-reviewer.md` | Finds bugs, not confirms correctness |
| clean-code | `.claude/agents/clean-code.md` | Industry best practices, readability, idiomatic TypeScript |

## LLM Constraints

Every pattern in this document exists to work around one or more of these.

### Hard Constraints

| Constraint | Implication |
|---|---|
| **Fixed weights** | Base weights do not update during a session. Externalize knowledge to files. |
| **Finite context** | Everything in context competes for attention. More loaded = more ignored. Keep context lean. |
| **Non-determinism** | Same input, different output. Parallel same-model runs are search, not verification. Verification requires tests. |
| **Black box** | Chain-of-thought is not guaranteed faithful. Treat it as a hint, not an audit artifact. |

### Failure Tendencies

| Tendency | Implication |
|---|---|
| **Context rot** | Performance degrades before the window fills. Reset often. |
| **Compliance bias** | Says "sure" to impossible requests. Grant explicit permission to push back. |
| **Solution fixation** | Latches onto first plausible answer. Force alternatives. |
| **Degrades under complexity** | Multi-step tasks accumulate errors. Break into small focused steps. |
| **Hallucinations** | Invents APIs and syntax. Code hallucinations are self-revealing (won't compile). Always verify. |

## Small Steps, Verified

- **Chain of small steps** — break down → execute one → verify → commit → next.
- **One thing at a time** — sequential focused tasks beat one complex multi-part task.
- **Smallest useful step** — minimum increment that's still meaningful. Sweet spot where verification is easy.
- **Happy to delete** — AI-generated code is cheap to regenerate. Time debugging bad output is expensive. Revert early.

## Testing & Verification

- **Red-green-refactor** — failing test (red), implement to pass (green), clean up. Never skip red.
- **Outside-in TDD** — acceptance test first, implement inward layer by layer.
- **Test behaviour, not implementation** — tests survive refactors. Implementation-coupled tests are liabilities.
- **Feedback loop** — clear success signal (tests pass) + permission to iterate = self-correction.

### Evidence Hierarchy

Not all verification is equal. Rank by strength:

| Rank | Evidence type | Notes |
|---|---|---|
| 1 | Reproducible runtime test or failure | Closes risk for the specific behaviour under test |
| 2 | Static/tool validation (type checker, linter) | Closes risk for the property it checks |
| 3 | Human inspection of diff or output | Depends on reviewer attention |
| 4 | Cross-family model review | Useful signal, not proof |
| 5 | Same-model self-review | Weakest — correlated priors |

A finding at rank 4 or 5 is a prompt to investigate, not confirmation. A passing test at rank 1 does not close risk if the test checks the wrong behaviour.

## Output Failure Modes

### False Rigour

| Pattern | What it is | Detect |
|---|---|---|
| Paper Guardrail | States protection without building it. The sentence is the only guardrail. | Is there a test or gate? If the only mechanism is the sentence, it's paper. |
| Right Answer, Wrong Work | Test asserts the correct outcome via the wrong causal path. Gate is green; actual behaviour is not verified. | Can you break the claimed behaviour while keeping the test green? |
| Semantic Inflation | Standard features become "novel contributions." Routine engineering becomes "genuinely unique." | Would adding this to a comparable project be trivial? If yes, it's not novel. |

### Verification Failures

| Pattern | What it is | Detect |
|---|---|---|
| Loom Speed | Plan granularity doesn't match execution granularity. Exceptions get lost at machine speed. | If the plan has N items, execution needs N verifiable steps. |
| Whack-a-Mole Fix | Fixing a class of problem one instance at a time. | Three commits of same shape in git log → audit the class. |
| Stowaway Commit | Unrelated changes bundled. Commit message becomes an inventory. | 3+ comma-separated concerns in a commit message. Stage selectively. |

### Anti-Patterns

| Anti-Pattern | What Goes Wrong | Fix |
|---|---|---|
| AI Slop | Accepting output without review | Always verify. Review is non-optional. |
| Distracted Agent | Overloading with too many responsibilities | Focused agents, single responsibility. |
| Flying Blind | No tests, no verification | Feedback mechanisms before starting. |
| Silent Misalignment | AI builds confidently in wrong direction | Check alignment before implementation. |
| Sunk Cost | Forcing failing approach instead of reverting | Code is cheap. Revert early, revert often. |
| Unvalidated Leaps | Large changes without intermediate verification | Small steps. Verify each. |
