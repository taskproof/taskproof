# Trying taskproof

A hands-on walkthrough of the whole loop: scaffold task specs, run real AI agents against
a site, and read the report. Pre-release — you run it from this repo (the npm package is a
reserved placeholder, so `npx taskproof` doesn't work yet).

## Prerequisites

- **Node ≥ 22** and **pnpm 10**
- An **Anthropic API key** — `export ANTHROPIC_API_KEY=sk-ant-…`
- A running spend appetite: a computer-use task costs roughly **$0.05–$2** depending on how
  many steps it takes. Every spec supports a hard `maxCostUsd` cap, and `run` takes
  `--max-cost`.

## Setup (once)

```bash
pnpm install
pnpm build
# Chromium for the Claude adapter:
pnpm --filter @taskproof/adapter-claude exec playwright install chromium
# convenience: a `taskproof` command for this shell (run from the repo root)
alias taskproof="node $(pwd)/packages/cli/dist/index.js"
export ANTHROPIC_API_KEY=sk-ant-…
```

`taskproof --help` should now list `validate`, `init`, `run`, `report`.

## The loop

### 1. Scaffold task specs for your site (free, no API calls)

```bash
taskproof init --url https://your-site.com --dir my-tasks
```

This detects your framework (Next.js, Vite, etc.) and writes three starter specs into
`my-tasks/` — a homepage-CTA task, a pricing→trial task, and a docs task. Open them and
edit the `goal` (what the agent should do) and the `assertions` (how success is judged).
Run `taskproof init` with no `--url` to be prompted interactively.

A task spec looks like this:

```yaml
specVersion: '0.1'
id: pricing-trial
goal: 'Find the pricing page and start a free trial of any paid plan.'
entryUrl: 'https://your-site.com'
maxSteps: 25 # give up after this many agent steps
maxCostUsd: 2.00 # hard budget cap for one run
passPolicy: # agents are non-deterministic — run k times, pass if ≥ minPasses succeed
  k: 3
  minPasses: 2
assertions: # ALL must hold for a run to pass
  - type: url # the final page URL matched a glob
    pattern: '**/trial**'
  # other assertion types:
  # - type: dom        # a CSS selector is attached / visible, or its text contains a string
  #     selector: "[data-testid=trial-confirmation]"
  #     state: visible
  # - type: network    # a request was made (method/status optional)
  #     urlPattern: "**/api/subscribe"
  #     method: POST
  #     status: "2xx"
```

Check a spec is valid any time (free): `taskproof validate my-tasks/*.yaml`

### 2. Run the agents against your site

```bash
taskproof run my-tasks/*.yaml --models claude-opus-4-8 --out runs
```

It runs each spec `passPolicy.k` times, grades each run against its assertions, prints a
pass/fail matrix with cost per cell, and **exits non-zero if any cell misses its
threshold** (so it works as a CI gate). Artifacts (per-step traces + screenshots) land in
`runs/`.

Useful flags:

- `--models claude-opus-4-8,claude-sonnet-4-6` — compare models (one column each)
- `--max-cost 1.50` — hard per-run USD cap, overrides the spec
- `-k 1` — override pass@k (a single run; good for a quick/cheap check)
- `--headed` — watch the browser instead of running headless

### 3. Read the report

```bash
taskproof report --dir runs --out runs/report.html
open runs/report.html
```

A single self-contained HTML file: the matrix up top, then each run expands to its
trace — the agent's narration, the actions it took, the screenshot after each step, and
exactly which assertion passed or failed.

## Try it right now (a public target, no setup of your own)

```bash
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

taskproof run /tmp/try.yaml --models claude-opus-4-8 --out runs -k 1   # ~$0.10–0.20
taskproof report --dir runs && open runs/report.html
```

## Optional: the browser-use adapter (second agent)

This compares Claude computer-use against [browser-use](https://github.com/browser-use/browser-use)
on the same tasks. It needs a Python sidecar (`uv` required).

```bash
# terminal 1 — start the sidecar (one-time install, then it stays running)
cd packages/adapter-browser-use/sidecar
uv sync
uv run browser-use install                 # fetches browser-use's Chromium
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY uv run uvicorn taskproof_sidecar.app:app --port 8765

# terminal 2 — run the matrix across both agents
taskproof run my-tasks/*.yaml --models claude-opus-4-8,browser-use --out runs
taskproof report --dir runs && open runs/report.html
```

Note (v0): the Claude adapter reads `ANTHROPIC_API_KEY` from your shell; the browser-use
adapter talks to the sidecar, which reads the key from _its_ shell. Known gap — browser-use
runs don't yet capture network requests, so `network` assertions won't pass for that
adapter (only `url` and `dom` do).

## What it costs / what to expect

- `validate` and `init` are free. `run` spends Anthropic tokens per agent step.
- Agents are non-deterministic — that's why grading is pass@k over several runs, not a
  single pass/fail. Use `-k 1` for cheap iteration while writing a spec; raise it for a
  real measurement.
- Start the `maxCostUsd` cap low while you iterate on a spec.
