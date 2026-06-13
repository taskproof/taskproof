# @taskproof/spec

The task-spec format: a versioned YAML schema describing a task an AI agent should be able to
complete on your site, plus the deterministic assertions that decide whether it did. This package
is the single source of truth for the format — the CLI, every runner adapter, and the report
generator all validate through it.

> Working name. The package scope will be renamed before public launch.

## A task spec

```yaml
specVersion: '0.1'
id: pricing-trial
goal: 'Find the price of the Team plan and start a free trial'
entryUrl: 'https://example.com'
allowedDomains: # optional — defaults to the entryUrl hostname
  - example.com
  - '*.checkout-provider.example.com'
maxSteps: 20 # default 20, max 200
maxCostUsd: 1.00 # optional hard budget cap per run
passPolicy: # default { k: 1, minPasses: 1 }
  k: 5 # run the task 5 times…
  minPasses: 4 # …pass if at least 4 succeed (agents are non-deterministic)
assertions: # at least one; ALL must hold for a run to pass
  - type: url
    pattern: '**/trial**'
  - type: dom
    selector: '[data-testid=trial-confirmation]'
    state: visible
```

## Fields

| Field            | Required | Notes                                                                                                                                                                                                  |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `specVersion`    | yes      | Format version, currently `"0.1"`. Must be a quoted string — YAML reads unquoted `0.1` as a number, which cannot round-trip versions (0.10 becomes 0.1), so the parser rejects it with a quoting hint. |
| `id`             | yes      | Kebab-case, stable across runs — baselines and diffs key on it.                                                                                                                                        |
| `goal`           | yes      | The natural-language instruction handed verbatim to each agent.                                                                                                                                        |
| `description`    | no       | Human-facing context; never shown to the agent.                                                                                                                                                        |
| `tags`           | no       | Free-form labels for filtering (`docs`, `smoke`, …).                                                                                                                                                   |
| `entryUrl`       | yes      | http(s) URL where every run starts. Credentials (`user:pass@`) are rejected — specs land in reports and artifacts.                                                                                     |
| `allowedDomains` | no       | Hostnames the agent may visit; `*.example.com` wildcards and `localhost` allowed. Defaults to the entry hostname.                                                                                      |
| `maxSteps`       | no       | Hard step cap before the run is failed (default 20).                                                                                                                                                   |
| `maxCostUsd`     | no       | Hard budget cap per run; the runner aborts past it.                                                                                                                                                    |
| `passPolicy`     | no       | pass@k with a threshold. The default (`k: 1`) is a single smoke run for local dev; CI gating should set `k ≥ 3` with a threshold — never a binary gate.                                                |
| `assertions`     | yes      | Deterministic checks, all required to pass. LLM-judge grading layers on top of these, never replaces them.                                                                                             |

## Assertion types

- **`url`** — glob pattern against the final page URL: `{ type: url, pattern: "**/order/confirmed**" }`
- **`dom`** — CSS selector against the final DOM with `state: visible | attached | text`
  (`text` requires a `text:` substring): `{ type: dom, selector: "h1", state: text, text: "Thank you" }`
- **`network`** — glob pattern against requests observed during the run, with optional `method`
  and `status` (exact code or class like `"2xx"`): `{ type: network, urlPattern: "**/api/orders", method: POST, status: "2xx" }`

Unknown keys anywhere in the document are rejected — typos fail loudly at validate time, not
silently at run time.

## API

```ts
import { parseTaskSpec, safeParseTaskSpec, taskSpecSchema, type TaskSpec } from '@taskproof/spec';

const spec = parseTaskSpec(yamlSource, { filename: 'tasks/pricing.yaml' }); // throws TaskSpecError
const result = safeParseTaskSpec(yamlSource); // { ok: true, spec } | { ok: false, error }
```

Errors are typed: `TaskSpecYamlError` (unparseable YAML), `UnsupportedSpecVersionError` (unknown
`specVersion`, carries `.supported`), `TaskSpecValidationError` (carries structured `.issues` with
`path` + `message`).

## Versioning

`specVersion` is a literal, not semver: parsers declare exactly which versions they support and
fail fast on anything else. Format changes will go through a public RFC process once the spec is
published; `0.x` versions may break between releases.
