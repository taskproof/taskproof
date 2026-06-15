# Contributing to taskproof

taskproof is an open-source CI harness that runs real AI agents through defined tasks on a
site and grades them. Contributions welcome — especially **new runner adapters** (the more
agents we can compare on identical terms, the more useful the harness is).

> Pre-release and built in public. Expect `0.x` churn; the task-spec format and run-artifact
> schema may still break between releases.

## Setup

Requires **Node ≥ 22** and **pnpm 10**.

```bash
pnpm install
pnpm build
pnpm test            # vitest across packages
pnpm lint            # eslint, type-checked
pnpm format          # prettier
pnpm -r run typecheck
```

Before opening a PR, all of `build` / `test` / `lint` / `format:check` / `typecheck` must
pass — CI runs them on every PR (`.github/workflows/ci.yml`).

## Repo layout

A pnpm + TypeScript monorepo. The dependency arrows all point at `@taskproof/core` and
`@taskproof/spec`:

- **`@taskproof/spec`** — the YAML task-spec format (Zod-validated, versioned).
- **`@taskproof/core`** — the shared contract: the `RunArtifact` schema, the `Adapter`
  interface, and the cache-aware `CostMeter`.
- **`@taskproof/grader`** — deterministic `url`/`dom`/`network` assertions + pass@k.
- **`@taskproof/judge`** — the optional WebJudge-style LLM judge (versioned prompt + golden set);
  runs after the deterministic checks and can only turn a pass into a fail.
- **`@taskproof/report`** — the HTML report and the baseline-diff engine.
- **`@taskproof/adapter-claude`**, **`@taskproof/adapter-browser-use`** — runner adapters.
- **`taskproof`** (`packages/cli`) — the CLI.

The browser-use sidecar (`packages/adapter-browser-use/sidecar`) is a separate Python project
managed with **uv**, linted with **ruff**, tested with **pytest**.

## The one rule that matters: identical artifacts

Every adapter emits the **identical** `RunArtifact` (from `@taskproof/core`) and grades
through the **same** `@taskproof/grader`. That uniformity is the whole point — it's what makes
a Claude run and a browser-use run directly comparable in one matrix. An adapter that invents
its own output shape or its own grading defeats it.

### Adding a runner adapter

1. Implement the `Adapter` interface (`run(input, config) => Promise<RunArtifact>`).
2. Drive your agent through the task; record each step (narration, actions, a screenshot).
3. Build a grader `Probe` (final URL, network log, a per-selector DOM result) and call the
   shared `evaluateAssertions` — **do not** reimplement grading.
4. Compute cost with `@taskproof/core`'s `CostMeter` so $/task is consistent across adapters.
5. Return the assembled `RunArtifact`. The CLI, grader, and report then work unchanged.

`@taskproof/adapter-claude` (in-process Playwright) and `@taskproof/adapter-browser-use`
(out-of-process Python sidecar) are two worked examples — copy whichever model fits.

## Conventions

- **TypeScript strict** (NodeNext, `exactOptionalPropertyTypes`), **vitest**, eslint + prettier.
- **The grader is graded.** Changes to assertion or (future) LLM-judge logic require a
  golden-set eval run — no behavior changes without regression numbers. That discipline is the
  project's signature; please keep it.
- **The task-spec format is a spec.** Breaking changes to it (or the artifact schema) go
  through an issue/RFC, not a drive-by edit — other tools are meant to consume it.
- Keep each change's tests alongside it; prefer pure, unit-testable logic with IO at the edges.
- Python sidecar: `uv`, `ruff check` + `ruff format`, `pytest`.

## Submitting

Open an issue first for anything non-trivial (a new adapter, a spec/schema change) so we can
agree on the shape. PRs should be focused, with passing checks and tests for new behavior. By
contributing you agree your work is licensed under the project's [Apache-2.0](LICENSE) license.
