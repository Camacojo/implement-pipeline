---
name: implement-plan
description: Phases 4–5 of the implement pipeline — a technical plan with interface contracts and an AC→test mapping (by the orchestrator for size S, by a Plan agent for M/L), an independent plan review for M/L, and the user's plan checkpoint. Usable standalone to get only a technical plan for an existing spec ("write a technical plan for <ticket>", or the same in the user's language). Triggers on "/implement-plan <slug>".
allowed-tools: Agent, AskUserQuestion, Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch
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
8. **Test mode per test area** (PIPELINE.md ground rule 13), per regression script too: `tests-first` when the area is a defect or the interface the tests call already exists; `with the code` for a new interface, naming the work package that writes those tests and script checks. A UI check that waits for an element, attribute or row the change adds is a new interface.
9. **External integrations** (PIPELINE.md ground rule 14), when the change calls a third-party API, SDK or provider: per integration the endpoint or API generation chosen, the vendor's current recommendation, source URL and date of lookup, and whether Phase 9 can call it for real. A choice that deviates from the vendor's recommendation (for example to share one adapter) states the cost for current models, not only the convenience.

Follow the project's architecture conventions; no patterns the codebase does not use unless the spec asks.

## Phase 5 — Plan review (M/L; skipped for S)

Brief a **fresh** reviewer with `spec.md`, `contracts.md`, the *work packages* and *risks* sections of `plan.md` (not the whole file), the project's architecture rules and review checklist. Its target is the contract, because that is what every later agent builds and tests against; it answers in writing, at most one page:

- Test mode right per area (ground rule 13)? A tests-first check against an element, attribute or field the change adds is **blocking**: it sends a test author after a UI that does not exist.
- Every AC covered and mapped to a test? **Per mapped test: can this assertion fail?** Name every test whose assertion restates its own fixture, or whose mechanism lives in a different unit than the file it is mapped to.
- Contracts complete for the tests-first areas? Name every identifier a test author would have to invent, and every helper the contract *calls* but never defines.
- A rule of the architecture or the review checklist violated? Name the rule.
- An external integration (plan item 9) without a documentation source, or chosen against the vendor's current recommendation? The reviewer checks the vendor's documentation itself (WebSearch/WebFetch) rather than trusting the plan or its own memory, and treats a legacy or restricted endpoint for the models the spec names as **blocking**.
- A missing edge case in the contract's own rules (precedence, ordering, empty and conflicting inputs), or a materially simpler approach?
- Per finding: **blocking** (a test would be written against something wrong or missing) or **non-blocking**.

**Resolution by cost, not by author.** Non-blocking findings and small blocking ones (a missing identifier, a wrong shape, an ordering rule) are applied by the **orchestrator** in `contracts.md` in place, in one edit pass, with one changelog line each in `plan.md`. Only a blocking finding that changes the approach (a different decomposition, a rule the planner has to redesign) resumes the planner with one message naming those findings. Maximum two rounds; unresolved disagreements go to the user in the checkpoint. (Measured: a review of 19 findings, 2 blocking, cost 11 minutes of review and 11 minutes of planner fix round in sequence; the 17 non-blocking edits were one-liners.)

## Checkpoint (always, also for S)

Present files, interfaces, AC→test mapping, work packages, risks, external integrations with their sources, review outcome — for S together with the specification in one message. Wait for approval — on an unattended run (PIPELINE.md ground rule 15) the orchestrator records the plan's choices under **Decisions to confirm** instead; record it with a timestamp in `state.md`, mark phases 4–5 `done`/`skipped`, hand over to `implement-build`.
