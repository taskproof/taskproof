# Changelog

All notable changes to taskproof are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the packages version in lockstep and,
while pre-release, follow `0.x` semantics — minor bumps may break the task-spec and run-artifact
schemas until `1.0.0`.

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-06-15

The first release: a working agent-usability harness end to end — write a task spec, run real
agents against your site, grade them, and diff against a baseline in CI.

### Added

- **Task-spec format** (`@taskproof/spec`) — versioned YAML, Zod-validated: a natural-language
  goal, `entryUrl`, `allowedDomains`, `maxSteps`, a soft `maxCostUsd`, a `passPolicy` (pass@k),
  `url`/`dom`/`network` assertions, and an optional LLM-judge `rubric`. Typed errors with readable
  paths; published as a spec other tools can consume.
- **Shared contract** (`@taskproof/core`) — the `RunArtifact` schema every adapter emits, the
  `Adapter` interface, and a cache-aware `CostMeter` with a **soft** per-run budget cap (stops
  before a turn it can't afford; overshoots by ≤1 turn since a turn's cost isn't known until
  billed).
- **Grading** (`@taskproof/grader`) — deterministic `url`/`dom`/`network` assertions and pass@k
  aggregation (a statistical threshold, never a binary gate).
- **LLM judge** (`@taskproof/judge`) — a WebJudge-style grader (versioned prompt + a golden-set
  eval) that runs _after_ the deterministic checks and can only turn a pass into a fail.
- **Report** (`@taskproof/report`) — a self-contained HTML report (the pass/fail matrix plus
  per-run traces with screenshots) and a baseline-diff engine for regression detection.
- **Adapters** — Claude computer-use (`@taskproof/adapter-claude`, in-process Playwright) and
  browser-use (`@taskproof/adapter-browser-use`, via a Python/FastAPI sidecar). Both emit the
  identical `RunArtifact` and grade through the same grader.
- **CLI** (`taskproof`) — `init`, `validate`, `run`, `report`, `baseline save`, and `diff`;
  `--models` for the matrix, a soft `--max-cost`, `-k` to override pass@k, `--timeout`, and
  `--no-judge`. Numeric flags are validated at the boundary.
- **GitHub Action** — diffs a run against a committed baseline and posts a sticky PR comment, with
  an optional (off-by-default) regression gate.

### Known limitations

- Two adapters so far (Claude computer-use, browser-use); Gemini and OpenAI adapters are planned.
- taskproof tests **automatable, API-driven** agents — not consumer agents without automation APIs
  (e.g. ChatGPT Atlas, Comet). Same frontier models power both, but it's a proxy, not the same run.
- browser-use network capture is same-origin HTTPS only; a `network` assertion on a cross-origin
  request isn't directly comparable to the Claude adapter (the report warns when this applies).
- The budget cap is soft, and is **not** enforced mid-run for browser-use (bound spend with
  `maxSteps` there).

[Unreleased]: https://github.com/taskproof/taskproof/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/taskproof/taskproof/releases/tag/v0.1.0
