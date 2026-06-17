# taskproof in CI (GitHub Actions)

Copy-paste workflow templates that run a taskproof agent-usability check on every pull
request and post the result as a sticky PR comment. They use the reusable composite action
at [`.github/actions/taskproof-comment`](../../.github/actions/taskproof-comment/action.yml).

| Template                                                             | Lane                       | Per-PR cost\*    | Extra setup            |
| -------------------------------------------------------------------- | -------------------------- | ---------------- | ---------------------- |
| [`agent-usability-claude.yml`](agent-usability-claude.yml)           | Claude computer-use        | ~$0.05–$2 / task | none (headless Chrome) |
| [`agent-usability-browser-use.yml`](agent-usability-browser-use.yml) | browser-use, Haiku (smoke) | a few ¢ / task   | Python sidecar (`uv`)  |

\* with `-k 1` (one pass per task). Costs scale with steps and with `k`. Keep the cheap lane
per-PR; run the full Claude matrix nightly or on release.

> **Live example:** taskproof dogfoods this action on its own repo —
> [`.github/workflows/agent-usability.yml`](../../.github/workflows/agent-usability.yml) is a
> working same-repo setup (local `./.github/actions/taskproof-comment`, one cheap control task,
> paid steps gated on the secret so PRs stay green until it's added).

## The model: baseline on the default branch, diff on the PR

taskproof catches **regressions** — a task×model cell that _used to_ pass pass@k and now
doesn't. That needs a point of comparison, so the workflow diffs each PR run against a
**baseline you commit to your repo**:

```bash
# On your default branch, once (and refresh when intended behavior changes):
taskproof run taskproof/tasks/*.yaml --models claude-opus-4-8 --out taskproof-runs
taskproof baseline save --to taskproof/baseline.json
git add taskproof/ && git commit -m "taskproof: baseline"
```

On a PR the action runs the same lane, then `taskproof diff` against `taskproof/baseline.json`.
`diff` uses unix-`diff` exit codes — **0 = clean, 1 = regression, 2 = error** — which is how
the action tells "regression (comment it)" from "the diff crashed". Before any baseline
exists the comment just says so; it never fails the build for a missing baseline.

## Setup checklist

1. **Specs**: `taskproof init --url https://your-site.com` → edit `taskproof/tasks/*.yaml`.
2. **Baseline**: commit `taskproof/baseline.json` (above), captured with the **same lane** you
   gate on so the cells line up.
3. **Secret**: add an `ANTHROPIC_API_KEY` repository secret (Settings → Secrets → Actions).
4. **Permissions**: the job sets `pull-requests: write` so it can post the comment.
5. Copy a template into `.github/workflows/` and edit the `taskproof/taskproof` repo refs.

## Blocking vs. advisory

`fail-on-regression` defaults to `'false'`: the comment appears but the check stays green, so
agent-usability is advisory at first (taskproof favors signal over binary gates, since agents
are non-deterministic). Flip it to `'true'` and add the check to your branch-protection rules
once you trust the signal.

## Caveats

- **Fork PRs**: pull requests from forks get a **read-only** `GITHUB_TOKEN`, so the comment
  step is skipped (it can't post). The run still happens and shows in the job summary. Posting
  on fork PRs requires `pull_request_target`, which runs with a write token — only adopt it if
  you understand the security implications (never check out and execute untrusted PR code under
  it). The templates intentionally use plain `pull_request`.
- **Published vs. from-source**: the Claude template installs the published `taskproof` from npm;
  the browser-use template still builds from source because it needs the Python sidecar. Pin a
  different CLI version by editing `taskproof: npx taskproof@<version>` in the Claude template.
- **Pin the action** in production: use
  `taskproof/taskproof/.github/actions/taskproof-comment@v0.2.0` (the current release tag), not
  `@main`; bump it when a new release ships.

## What the comment looks like

```markdown
### ⚠️ taskproof: 1 agent-usability regression(s)

| Change      | Task       | Model             | pass@k    |
| ----------- | ---------- | ----------------- | --------- |
| ✗ REGRESSED | `checkout` | `claude-opus-4-8` | 5/5 → 1/5 |

_Run cost: $1.2800 → $1.3400._
```

A clean PR instead gets `### ✅ taskproof: no agent-usability changes`. The comment is sticky:
each new push updates the same comment rather than stacking new ones.
