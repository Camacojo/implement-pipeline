---
name: implement-verify
description: Phase 9 of the implement pipeline — a fresh verifier agent walks through every acceptance criterion in the real application (Playwright for UI, HTTP calls for APIs, terminal for CLIs) and produces evidence per AC (screenshots, short videos only for flows, request/response logs), which is then shown to the user. Usable standalone to (re)verify a change and collect evidence ("verify <ticket> and collect evidence", or the same in the user's language). Triggers on "/implement-verify <slug>".
allowed-tools: Agent, Read, Grep, Glob, Bash, Edit, Write
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. Requires `spec.md` (ACs) and the project's "how to run / verify" docs; delta mode (from `implement-feedback`) verifies only the ACs marked in `feedback.md` plus a regression note for the rest. Writes `evidence/` and `evidence.md`.

## Phase 9 — Verification with evidence

Brief a **fresh** verifier agent with `spec.md`, the relevant project-docs sections (environment, URLs, test accounts, tooling) and the rules below. It walks through every AC in scope as a user or client would:

- UI: the real application via Playwright (MCP browser tools or a standalone script) against the project's local/test environment and test accounts.
- API/service: real HTTP calls with request and response.
- CLI/batch/other: run it and capture the output.

Evidence rules — one entry per AC in `evidence/`, index in `evidence.md` (AC → file(s) → verdict → how produced):

- **Screenshot** when a visual state proves the criterion; crop or highlight when it helps.
- **Video** only for multi-step flows or timing/animation that a screenshot sequence cannot show; short, AC in the file name.
- **Text log** (request/response, command output) for everything without a visual — kept in `evidence/` for the PR and the reviewers, not for the ticket.
- Evidence that does not prove an AC is noise. Test data the verifier changes (e.g. a fixture row) is restored and the restoration verified.

**The walkthrough lives in the project, not in the run** (PIPELINE.md → *Verification has one layer*). The checks for the ACs were added to the project's regression scripts in Phase 6 and are green since the gates. The verifier therefore does not write a script of its own — not in `evidence/`, not anywhere: a second script of the same checks costs as much as the first and is invisible to the next run. Its brief is:

1. Run the project's scripts with their screenshot/output option pointed at `evidence/` (the project docs name the option; in a project whose scripts cannot save screenshots, add that option to the script — it is a project asset — rather than a separate walkthrough). Copy the run's log to `evidence/`.
2. Map every AC to the check names and images that prove it, in `evidence.md`. A check that proves an AC is named after it in the script (Phase 6 rule); if an AC has no check, say so and produce the evidence by hand (next step).
3. Add only what the scripts cannot show: a screenshot of a state the script does not visit, a request/response pair for an error case the script does not send, the proof that data the walkthrough created is gone again. Each such addition is one short log or image and a line in `evidence.md`; if it is a check worth keeping, it goes into the project's script for the next run, not into a run-local file.
4. Time box: when step 1 covers every AC, the phase is a run and a mapping — minutes, not an hour. The verifier reports what it could not prove rather than building tooling to prove it.

Values a re-run needs (ids, labels, names) live in the project's `expected.json` (or equivalent), so a later round that only changes values updates that file and re-runs the script without a new agent.

Verifier constraints: one walkthrough; **no full-suite run** (a "suite green" AC references the orchestrator's log from Phase 7/8); output written to a directory the project's test runner does not wipe, copied to `evidence/` immediately; no test data left behind, and the cleanup proven (a count or a GET before and after).

A failing AC goes back to `implement-build` Phase 7 with the evidence attached; record the loop. The phase completes only when every AC in scope passes.

**Show the evidence to the user** right away, before the PR decision: list files with their AC and open the images and videos locally when the platform allows it — on macOS `open <files>` (Preview); elsewhere print the paths as links. Attaching the evidence to the ticket happens in `implement-deliver`.

Mark phase 9 `done` with timestamps; hand over to `implement-deliver`.
