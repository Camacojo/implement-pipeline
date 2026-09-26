---
name: implement
description: End-to-end delivery of a functional change in any codebase — from a ticket (Jira, GitLab, GitHub issue, …) or a description, through specification with acceptance criteria, optional visual design, technical plan and plan review, tests-first, implementation, code review, verification with evidence, to a PR the user approves. Orchestrates the phase skills implement-spec, implement-plan, implement-build, implement-review, implement-verify and implement-deliver; project conventions come from the project's own agent docs (CLAUDE.md). Resumable via a state directory. Triggers on "implement <ticket or description>", "/implement <ticket or description>" and their equivalents in the user's language (e.g. "implementeer", "bouw").
allowed-tools: Agent, AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write, Artifact, Skill
---

You are the **orchestrator** of the implementation pipeline. Read `PIPELINE.md` next to this file (`PIPELINE.md` in this skill's base directory) first; it holds the ground rules, the state directory contract, the size classes and the agent roster. This file only sequences the phase skills.

## Procedure

1. **Resume check** (PIPELINE.md → *State and resume*). If an open run matches the argument, resume at its first phase that is not `done` by invoking the phase skill that owns it. Otherwise start a new run.
2. Invoke the phase skills **in this order**, each with the slug (ticket key or description) as argument, and do not start the next before the previous reports its phases `done` in `state.md`:
   1. `implement-spec` — phases 0–3 (project knowledge, intake & triage, specification, design). Ends with the spec checkpoint, except for size S where the checkpoint is deferred to the plan.
   2. `implement-plan` — phases 4–5. Ends with the plan checkpoint (for S: spec + plan together).
   3. `implement-build` — phases 6–7. Ends with the full quality gates green.
   4. `implement-review` — phase 8. For S the next skill starts in parallel with review round 1; for M/L with round 2.
   5. `implement-verify` — phase 9. Ends with the evidence shown to the user.
   6. `implement-deliver` — phases 10–11. Ends with the PR(s) open, the ticket updated and the timing table printed.
3. Between skills print one progress line (PIPELINE.md ground rule 6) and write the phase timestamps.
4. Stop after `implement-deliver`, and end with one line that the next run belongs in a fresh session (PIPELINE.md → *Context budget*). Merging, releasing and further ticket transitions happen only when the user asks. Feedback on the PR or on test results is handled by `implement-feedback`, which reuses this run's state directory.

Do not inline the work of a phase skill here; if a phase needs to change, change that skill.
