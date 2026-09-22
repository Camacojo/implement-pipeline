---
name: implement-spec
description: Phases 0–3 of the implement pipeline — project-knowledge check of the agent docs, intake of a ticket (Jira, GitLab, GitHub issue, …) or description with size triage, specification with material questions, assumptions and testable acceptance criteria, and an optional visual design round. Usable standalone to produce only a specification ("write the spec / acceptance criteria for <ticket>", or the same in the user's language). Triggers on "/implement-spec <ticket or description>".
allowed-tools: Agent, AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write, Artifact
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. This skill covers phases 0–3 and writes `state.md`, `spec.md` and `design.md` in the state directory.

## Phase 0 — Project knowledge

Read `CLAUDE.md` / `AGENTS.md` at the root and in every sub-project, plus the documents they link. Check that they answer:

1. **Code style and formatting** — formatter/linter, config location, run command.
2. **Language conventions** — code, comments, tests, commits, PR text, UI strings, user communication.
3. **Architecture conventions** — where each kind of code lives, patterns to follow and to avoid.
4. **Test conventions** — types, locations, naming, fixtures/test data, how to run all and one.
5. **Quality gates / definition of done** — the commands that must pass.
6. **Workflow** — base branch, branch naming, commit format, PR/MR title and body, reviewers, labels, merge policy, release relation.
7. **Review checklist** — project-specific risks linters do not catch.
8. **Ticket system** — tracker, project keys, PR linking, the status when work starts and when the PR is ready (exact workflow names), assignment rule, how evidence is attached (tooling, limits).
9. **Verification** — how to run the app locally, URLs, test accounts/tokens, how to drive the UI and take screenshots, available tooling.
10. **Design** — UI framework, design system, where designs live, how mockups are made (UI projects only).
11. **Repository layout** — one repo or several, dependency order, what deploys separately.
12. **Skill shadowing** — a project-local skill with the same name as one of the pipeline skills (`.claude/skills/implement*/`) shadows it. If one exists, move what is still relevant into the project docs and remove it (ask when tracked in git).

For every topic that is missing or ambiguous: analyse code and history (linter configs, branch names, PR titles/bodies, test directories, CI config), draft a proposal, present all proposals together. Contradictory evidence (e.g. three branch-naming styles) is never resolved silently: ask via AskUserQuestion. Write approved answers into the project's docs (root or sub-project, in the docs' language) and record in `state.md` which docs were consulted and amended. When everything is covered, report `Project knowledge complete` in one line (in the user's language). Never skipped; cheap when the docs are complete.

## Phase 1 — Intake and triage

1. **Input.** Ticket key: fetch it with the ticket tooling (MCP, CLI, API): summary, description, acceptance criteria, attachments (designs!), comments, linked issues, priority. Tooling unavailable → say so and ask the user to paste it. Description: keep the user's wording.
2. **State directory** and `state.md` with the slug and the phase table.
3. **Affected repositories.** One branch and one PR per repository; note dependency order (API before client).
4. **Environment.** Start what tests and verification need, in the background (PIPELINE.md → *Environment*).
5. **Ticket status.** Move the ticket to the project's "work started" status and apply the assignment rule; record it.
6. **Size triage** S/M/L per PIPELINE.md, with a one-line justification in `state.md`.

## Phase 2 — Specification

1. **Current behaviour.** Read the relevant code; for M/L delegate the fan-out to an `Explore` agent with concrete questions — **unless the orchestrator built or reviewed this area earlier in the same session**, in which case write what you already know into `spec.md` and skip the agent. An explorer that reports back what you wrote an hour ago costs a full agent for no new information. Record findings in `spec.md`.
2. **Questions and assumptions.** Material questions (ground rule 5) and, separately, numbered assumptions with defaults. Ask everything at once; wait.
3. **Design needed?** Only for a new screen, interaction pattern or layout change; a field, column or button in an existing pattern is not. If needed and absent: ask the user to supply one or offer Phase 3.
4. **Acceptance criteria.** `AC-1 … AC-n`, Given/When/Then, each independently testable: happy path, every error and edge case found, authorization cases, non-functional criteria where relevant. Explicit **Out of scope** list.
5. **Checkpoint.** Present questions answered, assumptions, ACs, out of scope, design decision. Wait for approval; record the approved version. **Size S:** do not stop here — `implement-plan` presents spec and plan together.

## Phase 3 — Visual design (only when needed)

Otherwise record `skipped: no UI change` or `skipped: design supplied (<reference>)`.

1. Brief a designer agent with the spec, the project's UI conventions and the constraint **reuse existing components and patterns**.
2. Output, in order of preference per project docs and tooling: the project's design tool (e.g. Figma when configured), an HTML mockup via the Artifact tool, or an annotated screenshot of the existing screen. Load the `design` or `frontend-design` skill if available.
3. Show it to the user, collect feedback, iterate until approved. Record reference and rounds in `design.md`; add the reference to `spec.md`.

Mark phases 0–3 `done` (or `skipped`) with timestamps in `state.md` and hand over to `implement-plan`.
