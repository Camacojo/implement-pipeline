# Implement dashboard

A local web page that follows every implement-pipeline run on this machine: which phase it is in, which agents are working and what they are saying, which files each step touched, and every document the run wrote (spec, contracts, plan, tests, review, evidence with screenshots, PR record).

```
node tools/dashboard/server.js
open http://127.0.0.1:4680
```

Options: `--port 4680`, `--roots ~/Projects,~/Work` (directories to search for `.claude/implement/`, default `~/PhpstormProjects`), `--days 14` (how far back to read transcripts). No dependencies; Node 20 or newer.

## Where the data comes from

- **Runs and phases** — the state directory `<project>/.claude/implement/<slug>/`. The phase table in `state.md` is parsed tolerantly; an optional `events.jsonl` (`{"ts": "...", "phase": 4, "event": "start|done|skipped", "title": "..."}` per line) is honoured when present.
- **Agents, their output and the files they touched** — the transcripts Claude Code keeps under `~/.claude/projects/`. Every subagent has its own `.jsonl`; the brief names the run's state directory, which is how an agent is matched to a run. The orchestrator's session transcript supplies the agent descriptions, the orchestrator's own edits and the progress lines (`▶ implement · phase …`).
- **Live phase** — the state table only changes at phase ends, so the current phase is inferred from running agents and the last progress line.

The transcript format is Claude Code's internal one and may change; everything that depends on it lives in `lib/transcripts.js`.

## Layout

`server.js` serves the page, a small JSON API and a Server-Sent Events stream that fires when a state directory or a transcript changes. `lib/runs.js` discovers and parses runs, `lib/transcripts.js` indexes transcripts incrementally, `public/` is the page (vanilla JS, `marked` from a CDN for markdown).

## Feedback rounds

When `feedback.md` has one or more "Round N" headings with a date, the run page shows a row of round tabs above
the phase track: round 1 is the delivery, every later round is a feedback round. Selecting a round narrows the
phase track, the agents, the files and the journal to that round's time window (from the round's timestamp until
the next round, or until now). Phases in a feedback round are taken from the orchestrator's progress lines and
the agents that ran in the window; phases the round did not touch stay hollow. A feedback round counts as open
until a later round starts, the branch is merged, or nothing has happened for 30 minutes. While a round is open the
sidebar shows it as `R2 6/11`.

