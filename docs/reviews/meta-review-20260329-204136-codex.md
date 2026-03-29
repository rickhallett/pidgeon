# Meta Review

**Scope:** committed repository history through `66ea9d63a2b2f70deebf4d37df61516894fa9492`
**Date:** 2026-03-29T20:41:36Z
**Model:** codex
**Method:** `git log --reverse --stat`, targeted `git show`, `BUILD_ORDER.md`, `CLAUDE.md`, `devlog.yml`, existing review artifacts, and a fresh `bun test` run (`117 pass, 0 fail`)

Current workspace note: the worktree is dirty (`packages/carrier-ups/src/rate.ts`, `packages/core/src/index.ts`, untracked `packages/core/src/http.ts`, untracked review doc). Those local changes are excluded from the findings below because they are not part of the committed process record.

---

[HIGH] PROCESS — Key architectural steps do not show red-before-green evidence

  Where: commits `3a47d56`, `060d41a`, `5cfd49e`
  What: The repository claims strict TDD discipline, but the walking skeleton, OAuth lifecycle, and HTTP retry steps each introduced the new test file and the implementation in the same `feat:` commit.
  Why it matters: These are not minor cleanups. They are the highest-risk architectural slices in the build. When red and green collapse into one commit, the history cannot support the claim that implementation was demanded by a failing test rather than written first and tested afterward.
  Evidence: `CLAUDE.md` says "no implementation without a failing test demanding it. Red → green → refactor" and `BUILD_ORDER.md` says "Test first, implement, commit." Yet `3a47d56` adds both `packages/carrier-ups/src/rate.test.ts` and `packages/carrier-ups/src/rate.ts`, `060d41a` adds both `packages/carrier-ups/src/auth.test.ts` and `packages/carrier-ups/src/rate.ts`, and `5cfd49e` adds both `packages/carrier-ups/src/http-retry.test.ts` and implementation changes in `packages/carrier-ups/src/rate.ts`.
  Suggested fix: For major steps, preserve separate red and green commits even if they land minutes apart. If the team chooses to squash for presentation, record the red-phase evidence elsewhere before squashing.

[MEDIUM] PROCESS — Build-order compliance was corrected after the fact instead of being the active source of truth during execution

  Where: decision `015` in `devlog.yml`; commit `f3d90af`; `BUILD_ORDER.md`
  What: The process did document the step-6-before-step-4 reorder in `devlog.yml`, but `BUILD_ORDER.md` itself was only updated at the end of the build to match what had already happened, and step `11.5` was inserted retroactively to account for a substantial review-feedback block.
  Why it matters: A build-order artifact is supposed to guide execution, not merely describe it afterward. Once the canonical plan trails the actual work, the repo history no longer demonstrates adherence to the declared sequence; it demonstrates narrative repair.
  Evidence: `BUILD_ORDER.md` states "Each step is one or more atomic commits. Test first, implement, commit." and now includes step `11.5`. Commit `f3d90af` is explicitly titled "update BUILD_ORDER.md to reflect actual execution order." `devlog.yml` decision `015` records the step reordering, which shows the divergence was real and known before the final documentation update.
  Suggested fix: When sequencing changes, update `BUILD_ORDER.md` in the same decision/triage window that authorizes the reorder, before the implementation commits that depend on it.

[MEDIUM] PROCESS — Atomic-commit discipline broke down in several review and fix commits

  Where: commits `fbf1ffc`, `eb8b068`, `e6e72de`
  What: Multiple commits bundle unrelated concerns that the process rules say should remain separate.
  Why it matters: Stowaway changes make it harder to audit causality, revert safely, or verify whether a specific review finding was addressed cleanly. This is especially costly in a repository that is using commit history itself as a proof artifact.
  Evidence: `CLAUDE.md` says "Atomic commits — one concern per commit. Stowaway changes are a code smell." `fbf1ffc` mixes the error-boundary implementation with `devlog.yml` edits and a review-doc patch. `eb8b068` combines review imports, triage, devlog updates, agent definitions, and `CLAUDE.md` edits. `e6e72de` mixes coder-owned production fixes with tester-owned assertion and test-policy changes in one commit message and diff.
  Suggested fix: Split process/docs updates, code fixes, and test changes into separate commits. When triage produces both coder and tester work, keep those as distinct commits even if they come from the same session.

[MEDIUM] PROCESS — The review-feedback block relied on implementation-first fixes, with coverage repairs trailing later

  Where: commits `8347edd` through `87a1ac6`, followed by coverage commit `1a1469f`
  What: After the round-11 review set, a long block of feature/fix commits landed to align with the spec and review findings, but the historical evidence of failing tests leading those changes is weak and in some cases absent until much later.
  Why it matters: This is exactly the phase where review-driven work can devolve into paper rigor: findings are acknowledged, code changes are made, and only later are tests added that ratify the new behavior. That weakens confidence that the review fixes were verified in the causal order the process claims.
  Evidence: The existing audit in `docs/reviews/commit-history-audit-20260329-213000-claude.md` notes that commits `8347edd–d6e3c52` were "implementation-first by design" and that coverage was committed 12 commits later. The graph shows the review-feedback block landing as a run of `feat:` and `fix:` commits before `1a1469f` adds the explicitly labeled coverage-closing tests.
  Suggested fix: When a review finding demands code changes, add a failing regression test first whenever the behavior is testable. If the fix must land before the test, record that deviation explicitly in `devlog.yml` next to the finding rather than only in a later audit.

## Assessment

The repository does show real verification work: `bun test` is currently green, review findings were often triaged into `docs/triage/` and `devlog.yml`, and the step-6 reorder was at least documented rather than silently ignored. But the history does not fully support the stronger claims in `CLAUDE.md` and `BUILD_ORDER.md` about strict outside-in TDD, test-first sequencing, and atomic commit discipline. The result is credible as an implementation artifact, but overstated as a proof of rigorous process.
