# Sample report

A **real** taskproof report you can look at without installing anything or spending an API call.
Open [`report.html`](report.html) (it's self-contained), or
[view it rendered](https://raw.githack.com/taskproof/taskproof/main/examples/sample-report/report.html).

## What this run is

`saucedemo-problem-user-checkout` driven through two harnesses — **Claude computer-use**
(`claude-opus-4-8`) and **browser-use** — against [saucedemo.com](https://www.saucedemo.com)'s
`problem_user`, whose checkout form is deliberately broken. pass@3 on each. Both harnesses **fail**
the task (Claude 0/3, browser-use 1/3 — under the need-2 threshold), and the report pinpoints
where each stalls: Claude never gets a working item to checkout and loops on `/inventory.html`
(hitting its per-run cost cap on every run); browser-use reaches the sabotaged form at
`/checkout-step-one.html` and grinds it to its step limit, with one run fluking through. This is
the same run the project README's headline example is taken from — total **$14.19** across 6 runs.

## What's committed here

- `run-manifest.json` — the **full** run: both task×model cells, the real pass@3 results, cost,
  and step counts. The matrix in the report reflects all six runs.
- Trace artifacts + screenshots for **3 of the 6 runs** — one Claude failure, one browser-use
  failure, and the single run the _deterministic_ grader scored green. That last one is the
  instructive one: the agent reached the confirmation page by **navigating directly to
  `checkout-complete.html`**, bypassing the sabotaged form — its own final note says the task
  wasn't completed legitimately — yet the `url`/`dom` assertions passed. That's exactly the
  deterministic false-positive an LLM-judge layer (or a stricter `network`/step assertion) is meant
  to catch, and why pass@k plus a judge beats a single deterministic check. Each matrix cell links
  to a committed trace; the other three runs' per-step traces are omitted only to keep this
  directory small.
- `report.html` — the rendered report, regenerable from the files above.

Screenshots are downscaled to 640px JPEG so the whole sample is a few MB and the report is
hostable; a live run captures full-resolution PNGs.

## Regenerate it

```bash
node packages/cli/dist/index.js report --dir examples/sample-report --out examples/sample-report/report.html
# or, with the published CLI: taskproof report --dir examples/sample-report
```
