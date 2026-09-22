---
name: implement-deliver
description: Phases 10–11 of the implement pipeline — present the result, AC status, review outcome and evidence to the user and let them decide on the PR; then create the branch, commits and PR(s) per project convention, attach the evidence to the ticket with an AC-mapped comment, and move the ticket to its "PR ready" status. Update mode pushes a feedback round to an existing PR, updates its body, replies to review threads and re-attaches changed evidence. Triggers on "/implement-deliver <slug>".
allowed-tools: AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write, Skill
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. Requires the state directory with `spec.md`, `review.md`, `evidence.md`; **update mode** when `pr.md` already lists a PR for this slug. Writes `pr.md`.

## Phase 10 — PR decision

Present compactly: what was built per repository; AC status table with test and verification results; quality-gate results; review outcome (rounds, open non-blocking items); the evidence index (already shown in Phase 9); the proposed branch name(s), PR title(s), base branch, reviewers/labels and cross-repository merge order — all per the project's workflow conventions. Unrelated changes in the working tree are listed and excluded unless the user says otherwise.

Ask with AskUserQuestion: create (or update) the PR(s) now / not yet / adjust name or scope. "Not yet" → phase `waiting for user`, state kept, stop.

## Phase 11 — Pull request

Per affected repository, in dependency order:

1. **Branch and commits** per convention (reuse the project's commit/PR skill if it has one). Rebase on the current base branch before pushing; if the base moved in a way that touches the change, rerun the affected tests. Update mode: commit on the existing branch (one commit per feedback round, message names the round and the items).
2. **PR/MR body** per the project template; without one: **Summary**, **Ticket**, **Acceptance criteria** (with status), **Test plan**, **Evidence**, **Review notes**, **Related PRs** (siblings and merge order). Update mode: refresh the AC table and add a **Round N** section listing each feedback item and what was done.
3. **Evidence to the ticket.** The ticket is read by the business: attach only what shows the behaviour — screenshots and videos, one per AC, named `ac<n>-<what>.png`. Request/response bodies, suite logs and scripts stay in the state directory and are referenced from the PR body, never attached to the ticket. Use the ticket tooling — check the tools' *parameters*, not only their names (e.g. a Jira MCP update tool with an `attachments` argument); when the tooling lacks an operation (e.g. deleting an attachment), use the tracker's REST API with the credentials the MCP server itself is configured with (read them from its config at run time, never print them). Add a ticket comment with the PR link(s) and each attachment mapped to its AC. **Update mode:** attach the new evidence for the changed ACs, then **delete the superseded attachments** for those ACs (same AC, older round) so the ticket shows exactly one current image per AC; the round comment names what replaced what. GitLab: also upload via the project uploads API and embed in the MR. GitHub: link the PR body to the ticket attachments. Never commit evidence into the source repository unless the docs say so.
4. **Reviewers, labels, links** per convention. Update mode: reply to every review thread that was addressed (inline comments via the API's reply endpoint, review summaries via a PR comment) with what changed and where; re-request review.
5. **CI watch.** After the push, stay on the PR branch (a branch switch changes file mtimes and forces the next round to rebuild). Poll the PR checks while writing `pr.md` and the report, then wait for them (`gh pr checks <n> --watch` or the platform's equivalent, bounded by the project's usual pipeline duration; poll, do not sleep blindly). Every check must end `pass` — `cancelled`, `skipped` or "none pending" is not green. On a failure, read the failed job's log and classify:
   - **caused by the change** (test, lint, build, static analysis on our files) → a blocking finding: hand it to `implement-build` Phase 7 as a fix round, then the full gates and a new push; note in `state.md` why the local gates did not catch it and, if the local gates differ from CI, fix the project docs (Phase 0 topic 5);
   - **infrastructure or flake** (tool missing on the runner, network, a job that passed on the same base minutes earlier, no file of ours involved) → rerun the failed jobs once (`gh run rerun <id> --failed`); if it fails again, report it to the user as blocked with the log excerpt — never mark the run done on a red pipeline.
   Record the final check status per PR in `pr.md`.
6. **Ticket status:** move to the project's "PR ready" status (Phase 0 topic 8) only when CI is green. Update mode: leave the status unless the docs say otherwise.
7. Write `pr.md` (URLs, CI status, ticket actions, round), mark every phase `done`, print the PR URL(s), the ticket link, the evidence locations and the per-phase timing table.

Stop here. Merging, releasing and further ticket transitions happen only when the user asks (use the project's release skill if there is one).
