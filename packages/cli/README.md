# taskproof

The `taskproof` command line tool: run a matrix of real AI agents (Claude computer-use,
browser-use) through defined tasks on your site, score whether they actually complete each task,
pinpoint the exact failing step and its cost, and diff agent-usability across releases.

> Pre-release (`0.x`). The task-spec format and run-artifact schema may change between releases.

## Install

```bash
npm install -g taskproof      # or run ad hoc: npx taskproof <command>
taskproof install-browsers    # fetch the Chromium the Claude adapter drives
```

## Commands

- `taskproof init --url <site>` — detect your framework and scaffold starter task specs.
- `taskproof validate <files...>` — validate task-spec YAML against the schema (free, no API calls).
- `taskproof run <files...> --models <list>` — drive each agent through each task, grade with
  pass@k, print a pass/fail matrix with cost per cell, and write run artifacts. Flags: `--models`,
  `--max-cost` (soft per-run cap), `-k/--runs`, `--timeout`, `--headed`, `--no-judge`, `--out`.
- `taskproof report --dir <runs>` — render a self-contained HTML report (the matrix plus per-step
  traces with screenshots). `--max-image-width` downscales screenshots for a smaller, hostable report.
- `taskproof baseline save` / `taskproof diff` — snapshot a known-good run, then catch regressions in
  CI. `diff` uses unix-`diff` exit codes (0 = clean, 1 = regression, 2 = error).
- `taskproof install-browsers` — install the Chromium the Claude computer-use adapter needs.

## Quickstart

```bash
taskproof init --url https://your-site.com
# edit taskproof/tasks/*.yaml — the goal and the success assertions
export ANTHROPIC_API_KEY=sk-ant-...
taskproof run taskproof/tasks/*.yaml --models claude-opus-4-8
taskproof report --dir taskproof-runs && open taskproof-runs/report.html
```

## Writing task specs

A task spec is versioned YAML: a natural-language `goal`, an `entryUrl`, and deterministic
`url`/`dom`/`network` assertions that decide whether a run passed. The format, every field, and the
assertion types are documented in
[`@taskproof/spec`](https://github.com/taskproof/taskproof/tree/main/packages/spec). `taskproof init`
scaffolds editable starters; the defaults are SaaS-shaped (homepage CTA, pricing, trial), so reword
the goal and assertion to fit your site.

## More

The full walkthrough (CI/GitHub Action setup, the browser-use lane, and the fidelity-gap caveats) is
in the [project README](https://github.com/taskproof/taskproof#readme) and
[docs/TESTING.md](https://github.com/taskproof/taskproof/blob/main/docs/TESTING.md). Apache-2.0.
