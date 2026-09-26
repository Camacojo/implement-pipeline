# Changelog

All notable changes to the implement pipeline are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).
While the major version is 0 the pipeline is in beta: minor versions may change the state
directory contract, the phase table or the agent roster.

## [Unreleased]

## [0.1.0] - 2026-09-26

First beta.

### Added
- The eleven-phase pipeline as Claude Code skills: `implement` (orchestrator), `implement-spec`,
  `implement-plan`, `implement-build`, `implement-review`, `implement-verify`, `implement-deliver`
  and `implement-feedback`, with the ground rules, size classes, agent roster and state directory
  contract in `skills/implement/PIPELINE.md`.
- A Claude Code plugin manifest and marketplace entry, plus a symlink install for plain `/implement` names.
- A live dashboard (`tools/dashboard`, Node 20+, no dependencies) that follows runs from the state
  directories and the Claude Code transcripts: phase track with clock-derived durations, running and
  finished agents with their latest output, files touched per agent and phase, the run documents,
  evidence gallery, journal, git merge detection, and feedback rounds as separate time windows.

[Unreleased]: https://github.com/Camacojo/implement-pipeline/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Camacojo/implement-pipeline/releases/tag/v0.1.0
