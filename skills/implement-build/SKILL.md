---
name: implement-build
description: Phases 6–7 of the implement pipeline — a test-author agent writes failing automated tests for every acceptance criterion from the plan's interface contracts, then one or more dev agents implement the plan until those tests pass; the orchestrator runs the full quality gates once. Also used in delta mode by implement-feedback (tests and fixes for changed or new ACs only). Triggers on "/implement-build <slug>".
allowed-tools: Agent, Read, Grep, Glob, Bash, Edit, Write
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. Requires `spec.md`, `contracts.md` and `plan.md` (delta mode: also `feedback.md`, and only the ACs it marks as new/changed/defective are in scope). Writes `tests.md`, the code, and the results to `state.md`.

## Phase 6 — Tests first

Brief a test-author agent with `spec.md`, `contracts.md` (the identifiers and shapes it writes against) and the project's test conventions. When the plan's AC→test mapping spans two or more independent test areas with disjoint files (e.g. one service's tests vs. the tests of unrelated clients/handlers), brief one test author per area in the same message and let them run in parallel; each gets only its ACs and files. Rules for every test author:

- One or more automated tests per AC in scope, using **only** identifiers, endpoints, selectors and fixtures named in the plan. Something missing → **stop and report**; the orchestrator amends the plan and re-briefs.
- Follow the project's test locations, naming and language conventions.
- Run the new tests and prove each **fails on its assertion**, not on syntax, import or setup errors; include the failing output per test in `tests.md`.
- Negative assertions must be discriminating (assert the decisive attribute/state before the action, not just "nothing appeared" right after it).
- Record AC → test file → test name in `tests.md`.
- Delta mode, defect items: first strengthen or add the test that exposes the defect and show it red; never weaken an existing assertion.

**The project's regression scripts are tests too.** When the project docs name regression scripts that run against the live application (API walkthrough, UI walkthrough), the checks for the new ACs are written **now**, by a verify-script author briefed in the same message as the test authors, against `contracts.md` (endpoints, shapes, selectors, literal strings) — not by a Phase 7 developer after the code exists. Rules for that author: extend the project's scripts, never start a new one; every new check names its AC; run the extended script once against the unchanged application and show in `tests.md` that the new checks fail on their assertion (the AC does not exist yet) while the existing ones still pass; the script's own timing (a UI walkthrough easily takes minutes per run) is the reason it is written once here and not iterated in Phase 7. Something the contracts do not name → stop and report, like a test author. Phase 9 then runs these scripts for its evidence (PIPELINE.md → *Verification has one layer*).

After this phase the tests are **frozen**: developers may fix setup or fixtures only with a written justification in `tests.md` and may never weaken an assertion. The same holds for the extended regression scripts; a developer whose code makes a scripted check fail fixes the code, and reports a script defect (a wrong selector, a wrong expected value) with the evidence instead of editing the check.

## Phase 7 — Implementation

- Brief each dev agent with `spec.md`, `contracts.md`, `plan.md`, its work package, the test files it must make pass, and the project docs (relevant sections). **Name the project's smoke check** (its regression script and, for a UI change, the one navigation path that exercises the change the way a user reaches it) instead of letting each agent improvise one: dev agents that smoke-test a page with a direct reload miss the bugs that only appear when you navigate to it. Rules: follow the interface contracts exactly; follow project conventions; run lint/format/static analysis and **only the new and directly related test files** before reporting; rebuild/restart what the project docs require after source changes and wait with a blocking, timestamp-gated check; no files outside the package; no changes to frozen tests; report deviations from the plan explicitly, and append the report to `state.md`.
- Sequence packages in dependency order; run independent packages in parallel (one Agent call each, same message), with `isolation: worktree` when they share a repository. A work package holds application code only; the regression scripts were extended in Phase 6 and are not a package.
- Then the orchestrator runs the **full** test suite and all quality gates of every affected repository (ground rule 9) — the same set CI runs, per the project docs, including the extended regression scripts; if the docs list fewer gates than the CI workflow, run what CI runs and fix the docs. Fix or delegate any failure: a red scripted check is a code defect for the package that owns the AC, unless the developer shows the check itself is wrong (then the orchestrator corrects the check and records why in `tests.md`). Nothing proceeds while something is red. Record the exact commands and counts.
- Hand over to `implement-review` **as soon as the gates are green** — ground rule 12: nothing else that is still running (a script, a report) holds the diff export or the reviewer briefs.

Mark phases 6–7 `done` with timestamps; hand over to `implement-review`.
