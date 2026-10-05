# Changelog

All notable changes to the implement pipeline are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Reviewers check two things explicitly in every review (Part A0):
  - best practices for code and tests, including the regression and verification scripts, unless the
    project docs say otherwise;
  - file size, with the project's limit or 500 lines by default.

  A change that pushes a file over the limit, or adds a block to a file already over it, is blocking. The
  plan, the plan review, the briefs and Phase 0 carry the same two rules (PIPELINE.md → *Best practices and
  file size*).

### Changed
- Regression-script checks: a UI check against an element the change adds is written with the code, not
  tests-first. The plan review treats a wrong test mode as blocking.
- A pending red run no longer holds developers: they work in a worktree while the shared stack has to stay
  unchanged.
- One author per regression script, in parallel. Each gets a 15-minute budget and is briefed with the
  script's map instead of the whole file.
- implement-build starts the agent watcher together with the briefs.

## [1.2.0] - 2026-10-05

### Added
- `tools/release.sh`: one command to date the changelog, bump the manifests, tag, push and publish a release.
- External integrations are checked against the vendor's current documentation in the spec and plan, the
  plan review verifies that itself, and an integration that Phase 9 cannot call for real is reported as an
  open risk instead of a passed AC.
- Unattended runs record the checkpoints the orchestrator took itself as decisions to confirm, listed
  first in the Phase 10 report and the PR body.
- Watching agents: `skills/implement/agent-watch.mjs` measures each agent's active time against a budget per
  role and reports polling, repeated or long commands, tool timeouts, environment errors, compactions and
  error streaks; in `--wait` mode it runs in the background and wakes the orchestrator on the first new
  alert. PIPELINE.md says how to act on an alert.
- Agents never wait or poll for another agent's output; they report and end their turn.
- The dashboard shows gross and net run time (without the time spent waiting for the user) per run and per
  round, and an agent's working time instead of the time since it started.
- The code review flags added comments that restate the code or name the ticket.

### Fixed
- The dashboard reads progress markers that follow a sentence, so feedback rounds show their phases.
- The dashboard reloads after a reconnect, so changes missed while the server was down or the laptop slept
  show up, and a state directory that only holds files of another process is shown as not a pipeline run.

## [1.1.0] - 2026-09-26

### Added
- A live dashboard (`tools/dashboard`, Node 20+, no dependencies) that follows runs from the state
  directories and the Claude Code transcripts: phase track with clock-derived durations, running and
  finished agents with their latest output, files touched per agent and phase, the run documents,
  evidence gallery, journal, git merge detection, and feedback rounds as separate time windows.

### Changed
- Developers start alongside the test authors; verification is scoped to the touched layers; the
  regression scripts run once, in Phase 9; the express path is wider; plan review is contract-scoped.
- One model per role, 20-line agent reports and a context budget for the orchestrator.
- The phase table in `state.md` is mandatory and phase times come from the clock.

## [1.0.0] - 2026-09-22

First release as a Claude Code plugin.

### Added
- The eleven-phase pipeline as Claude Code skills: `implement` (orchestrator), `implement-spec`,
  `implement-plan`, `implement-build`, `implement-review`, `implement-verify`, `implement-deliver`
  and `implement-feedback`, with the ground rules, size classes, agent roster and state directory
  contract in `skills/implement/PIPELINE.md`.
- A Claude Code plugin manifest and marketplace entry, plus a symlink install for plain `/implement` names.

[Unreleased]: https://github.com/Camacojo/implement-pipeline/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Camacojo/implement-pipeline/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Camacojo/implement-pipeline/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Camacojo/implement-pipeline/releases/tag/v1.0.0
