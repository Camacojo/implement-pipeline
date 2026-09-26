# Implement pipeline — shared rules

Read this file first in every `implement-*` skill. It defines the contract between the phase skills: the ground rules, the state directory, the agent roster and how agents are briefed. The phase skills only add their own steps.

## Phase skills

| Skill | Phases | Reads | Writes |
|---|---|---|---|
| `implement-spec` | 0 project knowledge · 1 intake & triage · 2 specification · 3 design | ticket / description, project docs | `state.md`, `spec.md`, `design.md` |
| `implement-plan` | 4 technical plan · 5 plan review + checkpoint | `spec.md` | `contracts.md`, `plan.md` |
| `implement-build` | 6 tests first · 7 implementation + full gates | `spec.md`, `contracts.md`, `plan.md` | `tests.md`, code, `state.md` |
| `implement-review` | 8 code review (max two rounds) | diff, `spec.md`, `contracts.md` | `review.md` |
| `implement-verify` | 9 verification with evidence | `spec.md`, evidence rules | `evidence/`, `evidence.md` |
| `implement-deliver` | 10 PR decision · 11 PR / ticket | everything | `pr.md` |
| `implement` | orchestrates the six above in order | | |
| `implement-feedback` | intake of PR/test feedback → delta through build, review, verify, deliver | `pr.md`, PR comments, ticket comments | `feedback.md` |

A phase skill can be invoked on its own (for example `/implement-review` on a colleague's branch). Without a state directory it creates one from its argument, records which upstream artefacts are missing, and works from what exists (a review without `spec.md` uses the PR description as the specification).

## Ground rules

1. **Nothing project-specific lives in these skills.** Every convention (code style, language, branch names, PR format, test commands, review checklist, how to run the app, ticket statuses) comes from the project's agent docs: `CLAUDE.md` / `AGENTS.md` at the project root and in sub-projects, plus the files they link. Phase 0 guarantees those docs are complete. What future runs need goes into the project's docs, never into a skill.
2. **Documents are the hand-off mechanism.** Every agent starts fresh (no conversation context) and receives file paths: the spec, the plan, the project docs, its own brief. Everything a later phase or a resumed session needs is written to the state directory. Decisions the user makes in conversation are recorded there before moving on.
3. **Reviewers are fresh and independent.** Plan reviewers and code reviewers never see the author's reasoning, only the artefacts. Builders (test author, developers) get the spec and the plan.
4. **User checkpoints** — the user decides at exactly these points: the specification (end of Phase 2), the design (Phase 3), the plan (end of Phase 5), whether to open or update a PR (Phase 10), and in a feedback round the classification of the feedback. For size **S** the specification and the plan are presented together in one checkpoint. Code-review *findings* never go to the user; they are resolved between agents and listed in the PR. A *decision* a review surfaces (product, privacy, scope, operational trade-off) is different: it goes to the user immediately, in one AskUserQuestion asked while the fix round is already running, so the outcome lands in that same fix round instead of at the PR checkpoint.
5. **Ask only material questions.** A question is material when the answer changes what gets built. Everything else becomes an explicit, numbered assumption the user can override. Ask all questions of a phase at once.
6. **Report progress** at every phase transition and whenever an agent starts or finishes, in one line, in the language the user writes in:
   `▶ implement · phase 4/11 — Technical plan · planner agent started` / `✔ implement · phase 4/11 — Technical plan · done (plan.md)`. Never let an agent run silently.
7. **Do not skip ahead**, do not merge phases, do not let a builder do a reviewer's job or vice versa.
8. **Reviewers get a bounded diff.** Every review target is a patch file exported by the orchestrator, scoped to the round; never "the current changes".
9. **The orchestrator owns the quality gates.** The full test suite and full lint/static analysis run exactly once after Phase 7 and once after each fix round, by the orchestrator. Use the project's deterministic (serial) runner as the gate while it stays under about a minute; use a parallel runner only when the project docs mark it stable. A failure in a parallel run is re-checked once with the serial runner, never by re-running the parallel one. Agents run only the tests they wrote or touched. Reviewers verify by reading; they may run the single new test file, never the full suite, and never probe a live environment. This is the main cost driver.
10. **Measure.** Write a timestamp (`HH:MM`) at every phase start and end in `state.md`, plus each agent's duration and token count from its completion notice. The final report includes the per-phase timing table. **Take the time from the clock, never from memory:** run `date +%H:%M` (or `date "+%Y-%m-%d %H:%M"`) at each phase transition and copy its output; a guessed time is worse than none.
11. **The phase table is not optional.** `state.md` always carries the twelve-row phase table (`todo` / `in-progress` / `done` / `skipped`) and it is updated at every transition, also on the express paths where the orchestrator builds and tests itself and on runs that end in a local merge instead of a PR. Prose reports go below the table, never instead of it. Tooling (the dashboard, resume) reads the table, not the prose.

## Size classes (set in Phase 1, recorded in `state.md`)

- **XS (feedback deltas only)** — a feedback round whose items together touch at most three files and a few dozen lines, with no interface change and no new AC that needs a design. Express path: the orchestrator writes the test change (red first) and the fix itself, one fresh read-only reviewer (no built-in `code-review`), the verifier runs after the gates, then deliver in update mode. This deliberately collapses the test-author/developer split for the delta; the reviewer stays independent and the full gates still run.
- **XS text-only** — the delta changes only literals (labels, messages, copy) behind an existing constant or translation key, no logic. No red-first (the assertions already read the constant); change source and test constant together, run the affected spec and the full gates; no reviewer agent — the orchestrator's completeness check replaces it (grep old and new literal in source, tests, docs, PR body, ticket comments); evidence re-taken by re-running the stored evidence script (see `implement-verify`), no verifier agent unless the script cannot cover the change.
- **S** — one repository, a handful of files, no new interface (endpoint, schema, component API), no migration. Plan by the orchestrator; plan review skipped (checkpoint still happens, together with the spec); one dev agent; `code-review` at `medium`.
- **M** — one or two repositories, a new or changed interface, or a migration. Planner and plan reviewer are separate agents; one dev agent per repository, sequential in dependency order.
- **L** — multiple independent work packages. Separate planner and reviewer; the plan defines packages with disjoint file sets; one dev agent per package, parallel where independent.

**Review scales to the risk, not to the size class.** One fresh reviewer per *layer the change actually touches* (a backend service and a page are two layers; two services of the same kind are one). The built-in `code-review` skill is added only when the change touches cross-cutting output or infrastructure — logging, error tracking, messaging, serialization, config, security — not merely because the class is L. Measured on two L runs: four review agents on the first found zero blocking findings, two layer-scoped reviewers on the second found both blocking bugs. Review was a third of the token spend in each.

## State and resume

State directory: `<project root>/.claude/implement/<slug>/`, `<slug>` = ticket key (`ABC-123`) or a short kebab-case name from the description.

| File | Written in | Purpose |
|---|---|---|
| `state.md` | every phase | Phase status (`todo` / `in-progress` / `done` / `skipped` + reason), start/end time per phase, agent durations, size, affected repos, branch names, round number, decisions with timestamps, open questions |
| `spec.md` | Phase 2 | Intake, questions and answers, assumptions, acceptance criteria `AC-n`, out of scope, design reference |
| `design.*` / `design.md` | Phase 3 | The design or a link, plus feedback rounds |
| `contracts.md` | Phase 4/5 | **The only contract**: signatures with array shapes, request/response bodies, literal message strings, UI selectors, the AC→test mapping. Review findings are **applied in place**; never appended as an overriding section. Every agent reads this file, not the prose |
| `plan.md` | Phase 4/5 | Files to change, work packages, risks and edge cases, rollout, verification approach. Prose for humans; it never restates a contract |
| `tests.md` | Phase 6 | AC→test mapping, proof that each test fails on its assertion, justified setup changes |
| `review.md` | Phase 8 | Findings, blocking/non-blocking, resolution, rounds |
| `evidence/` + `evidence.md` | Phase 9 | Screenshots, videos, logs; index AC → file → verdict → how produced |
| `pr.md` | Phase 11 | PR/MR URLs, sibling links, ticket actions, timing table |
| `feedback.md` | feedback rounds | Feedback items `F-n` with source, classification, decision, resolution |

If the state directory sits inside a git repository and is not ignored, add `.claude/implement/` to `.git/info/exclude` unless the project docs say the state is committed.

**Resume:** on invocation, list `.claude/implement/*/state.md` that are not `done`. A named ticket or slug that matches an open run resumes it; with no argument and open runs, ask which to resume or whether to start new. Resuming = read the state files, print a short status, lightly re-verify prerequisites (branch exists, frozen tests present, working tree), continue at the first phase not `done`. Never redo a completed phase unless its inputs changed; say so if they did.

## Agent roster

Use the Agent tool; pick the most capable model for reasoning-heavy roles.

**An agent that has to write a file needs a write-capable agent type.** `Explore` and `Plan` are read-only: they cannot create `plan.md`, `explore.md` or any other artefact, and they end by pasting the document into their final message, which the orchestrator then has to retype. Use `general-purpose` for every role whose deliverable is a file in the state directory (planner, designer, test author, developer, verifier, and reviewers that write their own review). Read-only types stay useful for roles that only answer questions in their final message; when you brief one, say explicitly that the answer goes in the final message and keep it short enough to survive the hand-off.

| Phase | Role | Agent type | Model | Input |
|---|---|---|---|---|
| 2 | Explorer (M/L) | `Explore` | default | concrete questions about current behaviour |
| 3 | Designer | `general-purpose` | default | spec, project UI/design conventions, existing screens |
| 4 | Planner (M/L) | `general-purpose` | strongest available (`opus` unless the session model is stronger) | spec, project docs, codebase |
| 5 | Plan reviewer (M/L) | `general-purpose` | strongest available | spec, plan, project docs, review checklist |
| 6 | Test author | `general-purpose` | default | spec, plan, project test conventions |
| 7 | Developer(s) | `general-purpose` | default | spec, plan, work package, test files |
| 8 | Code reviewer(s) | `general-purpose` + available review skills | strongest available | diff, spec, project docs, review checklist — reads only the code, writes only its review file |
| 9 | Verifier | `general-purpose` | default | spec, project "how to run" docs, evidence rules |

**Every brief contains:** the goal; the paths to read first (project docs — name the relevant *sections*, not whole files — spec, plan); what to produce and where; what is **not** allowed (always: no full-suite runs unless the brief says so; no background waits — wait with a blocking loop gated on a timestamp taken before the action; no edits outside the named files); the exact format of the final report. Agents write their report to the state directory; the orchestrator summarises to the user. An agent that stops early is resumed with one message, not re-briefed.

## Environment

Start whatever the project docs need for tests and verification (containers, services) as early as Phase 1, in the background, and verify it responds before briefing the first agent that needs it.

**One writer on a shared test backend.** The full test suite and a verifier walkthrough (or any agent that creates data in the test environment) never run at the same time: run the suite, then the verifier, or the other way round. A collision shows up as a flaky, unrelated failure that costs a rerun.

**Rebuild awareness.** When the project tests against a prebuilt bundle, every source change and every branch switch (mtimes) forces a rebuild; stay on the PR branch while a PR is open, batch source changes before rebuilding, and prefer the project's dev-server option for a single spec run when the docs offer one.
