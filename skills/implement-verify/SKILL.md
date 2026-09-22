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

**The walkthrough lives in the project, not in the run.** Before writing anything, look for the project's existing regression script (the project docs name it; in a project without one, create it under `tools/verify/` and say so in the docs). A run **extends** that script with its new checks and re-runs the whole thing; it never starts a fresh script in the evidence folder: a new state directory makes the previous run's script invisible, and every run then rewrites the same walkthrough from scratch.

The walkthrough is a **stored, re-runnable script** (`evidence/verify.js` or the project's equivalent) that reads its expected values (labels, ids, names) from `evidence/expected.json`, so a later round that only changes values re-runs it without a new agent: update `expected.json`, run the script, copy the output. Later rounds extend the same script instead of writing a new one.

Verifier constraints: one walkthrough; **no full-suite run** (a "suite green" AC references the orchestrator's log from Phase 7/8); output written to a directory the project's test runner does not wipe, copied to `evidence/` immediately.

A failing AC goes back to `implement-build` Phase 7 with the evidence attached; record the loop. The phase completes only when every AC in scope passes.

**Show the evidence to the user** right away, before the PR decision: list files with their AC and open the images and videos locally when the platform allows it — on macOS `open <files>` (Preview); elsewhere print the paths as links. Attaching the evidence to the ticket happens in `implement-deliver`.

Mark phase 9 `done` with timestamps; hand over to `implement-deliver`.
