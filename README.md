# taskproof

Playwright + Lighthouse for the agent channel — an open-source CI harness that runs a matrix
of real AI agents (Claude computer use, browser-use, …) through defined tasks on your website,
docs, or MCP server, scoring task completion, cost, and the exact failure point, and diffing
agent-usability across releases.

> Status: pre-release. Runs from this repo for now — the npm package is a reserved placeholder.

## What it does

Write task specs (YAML: a natural-language goal + deterministic success assertions), point
taskproof at your site, and it drives real agents through each task, grades them with pass@k,
and renders a report that pinpoints where they failed — plus a baseline diff so CI catches
agent-usability regressions.

```text
$ taskproof run tasks/*.yaml --models claude-opus-4-8,browser-use

checkout-tshirt
  ✓ claude-opus-4-8      pass@5 5/5 (need 3)          $1.34
  ✗ browser-use          pass@5 1/5 (need 3)          $0.92

3/4 cell(s) passed · total $4.10        # exits non-zero in CI when a cell fails
```

## Quickstart

Requires Node ≥ 22, pnpm 10, and an `ANTHROPIC_API_KEY`.

```bash
pnpm install && pnpm build
pnpm --filter @taskproof/adapter-claude exec playwright install chromium
alias taskproof="node $(pwd)/packages/cli/dist/index.js"   # until the npm package ships
export ANTHROPIC_API_KEY=sk-ant-…

# Watch a real agent do a task, get graded, and render a report (~$0.10–0.20):
cat > /tmp/try.yaml <<'YAML'
specVersion: "0.1"
id: wikipedia-shannon
goal: "Search Wikipedia for 'Claude Shannon', open his article, and report his birth year."
entryUrl: "https://en.wikipedia.org/wiki/Main_Page"
maxSteps: 20
maxCostUsd: 5
assertions:
  - type: url
    pattern: "**/wiki/Claude_Shannon**"
YAML
taskproof run /tmp/try.yaml -k 1 --out runs
taskproof report --dir runs && open runs/report.html
```

The full walkthrough — `init` scaffolding, the spec format, multi-model matrices, the
browser-use sidecar, baselines, and CI — is in **[docs/TESTING.md](docs/TESTING.md)**.

## How it works

`taskproof init` scaffolds starter specs → `taskproof run` drives each agent through each
task (pass@k) and grades it against deterministic `url` / `dom` / `network` assertions →
`taskproof report` renders the matrix + per-step trace with screenshots → `taskproof baseline
save` + `taskproof diff` turn it into a CI regression gate.

The moat is uniformity: every runner adapter emits the **identical** run-artifact schema and
grades through the **same** grader, so a Claude run and a browser-use run are directly
comparable. Adding a vendor is implementing one interface — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Packages

| Package                                                          | What it is                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@taskproof/spec`](packages/spec)                               | The task-spec format — versioned YAML schema with Zod validation. Start here.      |
| [`@taskproof/core`](packages/core)                               | Shared contract: the run-artifact schema, the adapter interface, the cost meter.   |
| [`@taskproof/grader`](packages/grader)                           | Deterministic `url`/`dom`/`network` assertion engine + pass@k aggregation.         |
| [`@taskproof/report`](packages/report)                           | Self-contained HTML report + the baseline-diff regression engine.                  |
| [`@taskproof/adapter-claude`](packages/adapter-claude)           | Claude computer-use adapter (Playwright-managed Chromium).                         |
| [`@taskproof/adapter-browser-use`](packages/adapter-browser-use) | browser-use adapter, via a thin Python/FastAPI sidecar.                            |
| [`taskproof`](packages/cli)                                      | The `taskproof` CLI: `init` / `validate` / `run` / `report` / `baseline` / `diff`. |

## Development

```bash
pnpm install
pnpm build        # tsc, topological
pnpm test         # builds, then vitest across packages
pnpm lint         # eslint (type-checked)
pnpm format       # prettier
pnpm -r run typecheck
```

The browser-use sidecar is a separate Python (`uv`) project under
`packages/adapter-browser-use/sidecar` — see its README. Releases use `pnpm publish` (never
`npm publish`): internal deps are `workspace:^`, which only pnpm rewrites at pack time.

## License

[Apache-2.0](LICENSE) — chosen over MIT for the explicit patent grant, which matters if the
task-spec format becomes a standard others implement. The CLI, spec, adapters, grader, and
report generator are open forever.
