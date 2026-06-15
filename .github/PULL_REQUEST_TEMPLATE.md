<!--
Thanks for contributing to taskproof. Keep PRs focused. For anything non-trivial (a new
adapter, a spec/artifact-schema change) open an issue first so we can agree on the shape.
-->

## What & why

<!-- What this changes and the motivation. Link the issue it addresses. -->

Closes #

## Checklist

- [ ] `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm -r run typecheck` all pass
- [ ] Tests added/updated for the new behavior (kept alongside the change)
- [ ] **Grader / LLM-judge change?** Included golden-set eval numbers — no grading behavior change without regression numbers ([the grader is graded](https://github.com/taskproof/taskproof/blob/main/CONTRIBUTING.md#conventions))
- [ ] **Task-spec or `RunArtifact` schema change?** Linked an issue/RFC — these are a published spec other tools consume, not a drive-by edit
- [ ] **New / changed adapter?** Emits the identical `RunArtifact` and grades via the shared `@taskproof/grader` + `CostMeter` (no bespoke output shape or grading)
- [ ] **Touched the browser-use sidecar?** `ruff check`, `ruff format`, and `pytest` pass under `uv`

## Notes for the reviewer

<!-- Anything surprising, deliberately out of scope, or that you'd like a closer look at. -->
