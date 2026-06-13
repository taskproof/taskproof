# @taskproof/grader

The deterministic assertion engine. Given a task spec's assertions and a `Probe` over a
run's final state, it produces a typed pass/fail per assertion, and aggregates per-run
results against a pass@k policy.

- **`url`** — glob-match the final URL.
- **`network`** — glob-match a recorded request, optionally constraining method and status.
- **`dom`** — `attached` / `visible` / `text` against a selector. Visibility needs layout,
  so dom is evaluated against a **live page** during the run (the adapter does this and
  embeds the results in the artifact); `artifactProbe` re-grades url/network offline.

```ts
import { evaluateAssertions, deterministicPass, aggregatePassK } from '@taskproof/grader';

const results = await evaluateAssertions(spec.assertions, probe);
const passed = deterministicPass(results); // all assertions hold
const gate = aggregatePassK(perRunPassed, spec.passPolicy); // statistical threshold, not binary
```

Glob semantics: `**` matches across `/`, `*` stays within a path segment, patterns are
full-match anchored — use a trailing `**` to tolerate query strings. This is the
deterministic layer; the WebJudge-style LLM grader (later) layers on top, never replaces it.

> Pre-release.
