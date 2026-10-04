# Changelog

All notable changes to the implement pipeline are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `tools/release.sh`: one command to date the changelog, bump the manifests, tag, push and publish a release.
- External integrations are checked against the vendor's current documentation in the spec and plan, the
  plan review verifies that itself, and an integration that Phase 9 cannot call for real is reported as an
  open risk instead of a passed AC.
- Unattended runs record the checkpoints the orchestrator took itself as decisions to confirm, listed
  first in the Phase 10 report and the PR body.

### Fixed
- The dashboard reads progress markers that follow a sentence, so feedback rounds show their phases.

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

[Unreleased]: https://github.com/Camacojo/implement-pipeline/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Camacojo/implement-pipeline/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Camacojo/implement-pipeline/releases/tag/v1.0.0
