# implement-pipeline

A Claude Code plugin that turns a ticket or a description into a reviewed, verified pull request, in eleven phases with explicit user checkpoints and a resumable state directory.

| Skill | Phases |
|---|---|
| `implement` | orchestrates the six phase skills below in order |
| `implement-spec` | 0 project knowledge · 1 intake & triage · 2 specification · 3 design |
| `implement-plan` | 4 technical plan with interface contracts · 5 plan review + checkpoint |
| `implement-build` | 6 tests first · 7 implementation + full quality gates |
| `implement-review` | 8 code review (fresh reviewers, max two rounds) |
| `implement-verify` | 9 verification of every acceptance criterion with evidence |
| `implement-deliver` | 10 PR decision · 11 PR, ticket comment and status |
| `implement-feedback` | a feedback round (PR comments, test results) through the same pipeline |

The ground rules, the state directory contract, the size classes and the agent roster live in `skills/implement/PIPELINE.md`. Every phase skill can also be invoked on its own.

## Nothing project-specific lives here

The skills contain no conventions of any project. Everything they need (code style, language, branch names, PR format, test commands, review checklist, ticket workflow, how to run the app) is read from the project's own agent docs: `CLAUDE.md` / `AGENTS.md` at the project root and in sub-projects. Phase 0 checks those docs for twelve topics and proposes additions where they are missing, so the first run in a new project is mostly a documentation round.

## Install

As a plugin (updates via `/plugin update`):

```
/plugin marketplace add Camacojo/implement-pipeline
/plugin install implement@implement-pipeline
```

Plugin skills are namespaced, so the slash commands become `/implement:implement`, `/implement:implement-review` and so on. Natural language ("implement ABC-123", "review this PR against the project guidelines") triggers them without the prefix.

Alternatively, as plain personal skills (short `/implement` names, updates via `git pull`):

```
git clone https://github.com/Camacojo/implement-pipeline.git ~/implement-pipeline
for d in ~/implement-pipeline/skills/*; do ln -s "$d" ~/.claude/skills/$(basename "$d"); done
```

Do not install both ways at once.

## What the pipeline expects from the environment

- Claude Code with the Agent tool (the pipeline briefs fresh agents for planning, plan review, test authoring, development, code review and verification).
- Access to the ticket system where the project uses one (for example a Jira MCP server, `gh` for GitHub issues) and to the code host CLI (`gh` or `glab`) for pull requests and CI status.
- A way to drive the application for evidence: a Playwright MCP server or a local Playwright install for UIs, HTTP access for APIs.
- The project's local test environment as described in its docs.

## State directory

Each run writes to `<project root>/.claude/implement/<slug>/` (spec, contracts, plan, tests, review, evidence, PR record). It is meant to stay out of git; the pipeline adds it to `.git/info/exclude` unless the project docs say the state is committed.
