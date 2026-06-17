# Trying taskproof

A hands-on walkthrough of the whole loop: scaffold task specs, run real AI agents against
a site, and read the report. taskproof is published to npm (`npm i -g taskproof`, or `npx
taskproof`); it's pre-release (`0.x`), so the task-spec and run-artifact schemas may change
between releases.

## Prerequisites

- **Node ≥ 22** and **pnpm 10**
- An **Anthropic API key** — `export ANTHROPIC_API_KEY=sk-ant-…`
- A running spend appetite: a computer-use task costs roughly **$0.05–$2** depending on how
  many steps it takes. Every spec supports a soft `maxCostUsd` cap (on Claude the run stops
  before a turn it can't afford, so it can overshoot by ≤1 turn's cost; browser-use is bounded
  by `maxSteps`, not cost), and `run` takes `--max-cost`.

## Setup (once)

```bash
npm install -g taskproof          # or use `npx taskproof <command>` throughout
taskproof install-browsers        # Chromium for the Claude adapter
export ANTHROPIC_API_KEY=sk-ant-…
```

`taskproof --help` should list `validate`, `run`, `report`, `init`, `baseline`, `diff`,
`install-browsers`.

Working from a clone instead (contributors)? Run `pnpm install && pnpm build`, install Chromium
with `pnpm --filter @taskproof/adapter-claude exec playwright install chromium`, and alias the
local build: `alias taskproof="node $(pwd)/packages/cli/dist/index.js"`.

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
maxCostUsd: 2.00 # soft budget cap for one run (Claude only; browser-use bounds on maxSteps)
passPolicy: # agents are non-deterministic — run k times, pass if ≥ minPasses succeed
  k: 3
  minPasses: 2
assertions: # ALL must hold for a run to pass
  - type: url # the final page URL matched a glob
    pattern: '**/trial**'
  # other assertion types:
  # - type: dom        # a CSS selector is visible / attached / contains text / absent / hidden
  #     selector: "[data-testid=trial-confirmation]"
  #     state: visible   # also: attached | text | absent (gone) | hidden (dismissed)
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
- `--max-cost 1.50` — soft per-run USD cap (Claude only; browser-use runs to `maxSteps`), overrides the spec
- `-k 1` — override pass@k (a single run; good for a quick/cheap check)
- `--headed` — watch the browser instead of running headless

### 3. Read the report

```bash
taskproof report --dir runs --out runs/report.html
open runs/report.html
```

The report inlines full-resolution screenshots, so a multi-run report can be tens of MB. To
produce a smaller, **hostable** report (e.g. to link from a README via raw.githack), downscale
the screenshots to JPEG:

```bash
taskproof report --dir runs --out runs/report.html --max-image-width 800   # ~5× smaller
```

A single self-contained HTML file: the matrix up top, then each run expands to its
trace — the agent's narration, the actions it took, the screenshot after each step, and
exactly which assertion passed or failed.

### 4. Save a baseline and catch regressions

A single run tells you whether agents can do the task today. A **baseline** lets you catch
the day a release breaks it. Snapshot a known-good run, then diff future runs against it:

```bash
# capture the current run as the baseline (reads <dir>/run-manifest.json)
taskproof baseline save --dir runs --to baseline.json

# …later, after a change, run again into runs/, then:
taskproof diff --dir runs --baseline baseline.json
```

`diff` compares cell by cell and reports what changed — regressed (was passing pass@k, now
failing), fixed, improved/worsened, added/removed. It uses unix-`diff` exit codes so it
slots into any CI gate: **0 = no regression, 1 = a regression, 2 = the diff itself failed.**

```text
taskproof diff vs baseline

  ✗ REGRESSED  checkout / claude-opus-4-8                   5/5 → 1/5

1 regression(s), 0 fix(es), 2 unchanged · cost $1.2800 → $1.3400
```

Add `--markdown` to get a GitHub-flavored comment instead (that's what the PR-comment Action
posts — see below).

### 5. Wire it into CI (GitHub Action + PR comment)

The point of the baseline is a PR comment that says _"checkout: claude-opus-4-8 5/5 → 1/5"_
the moment a change regresses agent usability. The pattern is: commit a baseline on your
default branch, then on each PR run the cheap lane and `diff --markdown` against it, and post
a sticky comment.

Ready-to-copy workflow templates and a reusable composite action live in
**[`examples/github/`](../examples/github/)** — one Claude lane, one cheap browser-use lane,
plus a setup checklist (secrets, baseline, the fork-PR caveat, advisory-vs-blocking). The
comment is sticky (it updates in place) and, by default, advisory — it never blocks the
merge until you opt in, because agents are non-deterministic and pass@k is a signal, not a
hard gate.

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
adapter talks to the sidecar, which reads the key from _its_ shell. Known gap — the
browser-use lane captures **same-origin HTTPS** network traffic (the site's own API calls),
but a cross-origin navigation to a new origin is missed, so `network` assertions against a
third-party/cross-origin endpoint won't pass on that adapter (`url` and `dom` always do).

## What it costs / what to expect

- `validate` and `init` are free. `run` spends Anthropic tokens per agent step.
- Agents are non-deterministic — that's why grading is pass@k over several runs, not a
  single pass/fail. Use `-k 1` for cheap iteration while writing a spec; raise it for a
  real measurement.
- Start the `maxCostUsd` cap low while you iterate on a spec.

## The fidelity gap (important)

taskproof drives **automatable** agent harnesses — Claude computer-use and browser-use — as a
**proxy** for the consumer agents your users actually run (ChatGPT Atlas, Perplexity Comet, …),
which expose no automation API to test against. The same frontier models power both, but
taskproof does **not** claim its harnesses behave identically to those products. Read a result
as "a capable agent harness can/can't complete this," not "Atlas will/won't." A calibration
study with design partners is planned.
