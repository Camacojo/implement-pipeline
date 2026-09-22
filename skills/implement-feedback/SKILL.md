---
name: implement-feedback
description: Process feedback on a PR or on test results for a change delivered with the implement pipeline — collects review comments from the PR, ticket comments and the user's own remarks, classifies each item (defect, requirement change, question, out of scope), gets the user's decision, then runs the delta through implement-build, implement-review, implement-verify and implement-deliver (update mode) on the same state directory as a new round. Triggers on "process the feedback on <PR/ticket>", "/implement-feedback <slug | ticket | PR url> [feedback text]" and their equivalents in the user's language.
allowed-tools: Agent, AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write, Skill
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. This skill needs an existing run: a state directory with `spec.md`, `contracts.md`, `plan.md`, `tests.md` and `pr.md`. Without one, stop and say which run is missing (a change not built with the pipeline first needs `implement-spec` to reconstruct spec and ACs from the PR).

## Round intake

1. **Locate the run.** Resolve the argument (slug, ticket key or PR URL) to a state directory; increment the round number in `state.md`; start timestamps.
2. **Collect feedback** from every source and record each item as `F-n` in `feedback.md` with source, author, verbatim quote, location (file/line, AC, ticket):
   - PR review comments and inline comments (`gh pr view --comments`, `gh api .../pulls/N/reviews`, `.../pulls/N/comments`; GitLab equivalents), newer than the last round in `pr.md`;
   - ticket comments newer than the last round;
   - the user's own text from the invocation;
   - failed CI checks on the PR (`gh pr checks`, failed job logs) that appeared after the last round — classified like any other item (defect when our change caused it; infrastructure/flake when not, handled by a rerun as in `implement-deliver` step 5).
   Deduplicate; keep the reviewer's wording.
3. **Classify each item** and propose a decision:
   - **Defect** — the built behaviour violates an existing AC or a project rule → fix; the exposing test is strengthened first.
   - **Requirement change** — new or changed behaviour → new `AC-n` or amended `AC-x` in `spec.md`; the contract change applied in `contracts.md` in place, with a changelog line in `plan.md`.
   - **Question / discussion** — no code; draft the answer.
   - **Out of scope** — draft a follow-up ticket summary.
4. **Checkpoint.** When the only source is the user's own instruction in the invocation and its classification is unambiguous (one item, clearly a defect or a concrete requirement change), do not ask: state the classification, the affected ACs and the size class in one message and proceed; the same applies to the PR-update decision at the end of such a round (the instruction implies delivery to the open PR). In every other case present the table: item, quote, classification, proposed decision, and for questions the draft answers. The user confirms or reclassifies. Record decisions with timestamps in `feedback.md` and `state.md`. Requirement changes that alter the plan's interface contracts get their plan delta written before proceeding (orchestrator for S-sized deltas, `implement-plan` Phase 4 for larger ones).

## Delta run

Scope for the phase skills is the set of ACs marked in `feedback.md` (defects → their AC; changes → the new/amended ACs). First size the delta (PIPELINE.md → *Size classes*) and record it in `state.md`.

**XS express path** (delta touches ≤ 3 files, a few dozen lines, no interface change): the orchestrator does the build itself — strengthen or rewrite the affected tests, run them red, apply the fix, run lint plus the affected test files, then the full gates — then one fresh read-only reviewer (`implement-review` rules, patch by path, no built-in `code-review`) and, **after the gates have finished** (shared test backend), `implement-verify` in delta mode; the two may overlap with each other. Blocking findings: fix, gates again, re-verify the affected ACs. Then `implement-deliver` in update mode. Expected wall time in the order of ten minutes plus checkpoints.

**XS text-only path** (only literals behind an existing constant change, see PIPELINE.md): change the source constant and the test constant together, run the affected spec, lint and the full suite; do the completeness grep (old and new literal in `src/`, `tests/`, docs, PR body, ticket comments) yourself instead of briefing a reviewer; update `evidence/expected.json` and re-run the stored evidence script to refresh the affected screenshots; then `implement-deliver` in update mode. Expected wall time a few minutes.

**S and larger:** invoke in order:

1. `implement-build` in delta mode — Phase 6 for the new/changed/defective ACs (red first), Phase 7 fixes, then the orchestrator's full gates.
2. `implement-review` — on the diff since the last round's commit only, exported as `diff-<round>.patch` and passed by path; `medium` effort. For an S-sized delta step 3 starts in parallel with review round 1.
3. `implement-verify` in delta mode — affected ACs with fresh evidence; one line per unaffected AC stating that the full suite covers it.
4. `implement-deliver` in update mode — push to the existing branch, PR body round section, replies to the addressed review threads, ticket comment and changed evidence, re-request review.

Questions are answered in their threads during step 4 with the approved text; out-of-scope items become tickets only when the user said so in the checkpoint.

Print the round's timing table. Stop; further feedback starts a new round with the same command.
