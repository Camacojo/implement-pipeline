---
name: implement-plan
description: Phases 4–5 of the implement pipeline — a technical plan with interface contracts and an AC→test mapping (by the orchestrator for size S, by a Plan agent for M/L), an independent plan review for M/L, and the user's plan checkpoint. Usable standalone to get only a technical plan for an existing spec ("write a technical plan for <ticket>", or the same in the user's language). Triggers on "/implement-plan <slug>".
allowed-tools: Agent, AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write
---

Read `PIPELINE.md` in the `implement` skill directory (`../implement/PIPELINE.md` relative to this skill's base directory) first. Requires `spec.md`; standalone without one, write a minimal spec from the argument and say so. Writes `plan.md`.

## Phase 4 — Technical plan

Author: orchestrator (S) or a planner agent (M/L). The phase writes **two** files, and the split is the point:

- **`contracts.md` — everything a test can be written against, and nothing else.** Signatures with array shapes, request/response bodies with status codes, every literal message string, database changes, UI element identifiers, configuration keys, fixtures, and the AC→test mapping. No prose, no rationale, no alternatives considered. This is the file every later agent reads; keep it short enough that ten agents can read it without thinking about cost.
- **`plan.md` — the prose for humans.** Files to change with reasons, work packages, risks and edge cases, rollout, verification approach. It points at `contracts.md` and never restates a contract.

A review finding that changes a contract is **applied in `contracts.md` in place**, with a one-line entry in `plan.md`'s changelog saying what changed and why. Never append an overriding section: a contract that lives in four layers, each overriding the last, forces every brief to explain which one wins; in practice most blocking plan defects come from exactly this.

`plan.md` **must** contain:

1. **Files to change** per repository, with reason.
2. A pointer to `contracts.md` and a **changelog** (empty at first) for contract changes made after the checkpoint.
3. A one-paragraph design note: the approach, and the alternatives rejected with the reason.
4. **Work packages** (M/L) with disjoint file sets and dependency order.
5. **Risks and edge cases** beyond the ACs and how they are handled.
6. **Rollout notes** — migrations, flags, configuration, cross-repository order, backwards compatibility.
7. **Verification approach** for Phase 9 — what is demonstrated and how, and where the verifier writes its output (a directory the test runner does not wipe).

Follow the project's architecture conventions; no patterns the codebase does not use unless the spec asks.

## Phase 5 — Plan review (M/L; skipped for S)

Brief a **fresh** reviewer with `spec.md`, `plan.md`, the project docs and review checklist. It answers in writing:

- Every AC covered and mapped to a test?
- **Per mapped test: can this assertion fail?** Name every test whose assertion restates its own fixture, or whose mechanism lives in a different unit than the file it is mapped to. This one question catches a whole class of dead tests and costs the reviewer nothing.
- Interface contracts complete enough to write tests **before** implementation? Name every identifier a test author would have to invent, and every helper the contract *calls* but never defines.
- Architecture and review checklist respected? Name the violated rule.
- Missing edge cases, risks, a materially simpler approach?
- Per finding: **blocking** or **non-blocking**.

The planner (or orchestrator for S) resolves blocking findings and appends the resolution. Maximum two rounds; unresolved disagreements go to the user in the checkpoint.

## Checkpoint (always, also for S)

Present files, interfaces, AC→test mapping, work packages, risks, review outcome — for S together with the specification in one message. Wait for approval; record it with a timestamp in `state.md`, mark phases 4–5 `done`/`skipped`, hand over to `implement-build`.
