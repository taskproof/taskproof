# Sample report — a real production site (EV Intersection)

A taskproof run against a **live production site**, not a sandbox:
[evintersection.com](https://www.evintersection.com), a searchable catalog of electric vehicles.
Open [`report.html`](report.html) (self-contained), or
[view it rendered](https://raw.githack.com/taskproof/taskproof/main/examples/sample-report-ev/report.html).

## The run

Three real agent journeys — search → vehicle page, the curated best-electric-trucks list, and the
side-by-side compare — driven through **two harnesses on the same model** (Claude computer-use,
which sees pixels, and browser-use, which sees the DOM; both on Opus 4.8), pass@3. All six
task×harness cells pass — the interesting part is the cost/step spread:

| Task                       | Claude computer-use (steps · pass@3 $) | browser-use (steps · pass@3 $) |
| -------------------------- | -------------------------------------- | ------------------------------ |
| best-electric-trucks       | 2 · **$0.15**                          | 3 · $0.80                      |
| search-rivian-r1t          | 5 · **$0.66**                          | 4 · $1.10                      |
| compare-tesla-model-3-vs-y | 14 · $2.96                             | 7 · **$2.71**                  |

Same brain, two pairs of eyes: browser-use often takes fewer or equal steps but its DOM-context
steps cost more (so Claude is cheaper on the two simpler tasks), while the dense multi-select
compare is the friction point for both — Claude grinds to its 14-step limit, browser-use is
pricier per step. Neither harness wins everywhere.

## What's committed

- `run-manifest.json` — the **full** 6-cell matrix (real pass@3 results, cost, steps).
- Trace artifacts + screenshots for the linked run of each cell (every matrix cell links to one).
- `report.html` — regenerable with `taskproof report --dir examples/sample-report-ev`.

Screenshots are downscaled to 640px JPEG for a hostable size; a live run captures full-resolution
PNGs. This is **dogfood, not an independent audit** — the maintainer owns this site.
