# @taskproof/adapter-claude

The Claude computer-use runner adapter. Given a task spec, it drives a
Playwright-managed Chromium instance through Anthropic's computer-use API and emits a
`@taskproof/core` `RunArtifact` — the same shape every other adapter produces.

```ts
import { createClaudeAdapter } from '@taskproof/adapter-claude';
import { parseTaskSpec } from '@taskproof/spec';

const adapter = createClaudeAdapter();
const artifact = await adapter.run(
  { spec: parseTaskSpec(yaml), runId: 'run-1' },
  {
    model: 'claude-opus-4-8',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxCostUsd: 1.0,
    artifactsDir: 'taskproof-runs',
  },
);
```

What it does each turn: screenshot → send to Claude with the `computer` tool → execute
the requested actions on the page (clicks, typing, scrolling, drags, key combos, zoom) →
return a fresh screenshot. It tracks token cost with a hard `--max-cost` cap, records a
per-step trace (narration + actions + screenshots), and logs network requests.

- **Models:** `computer_20251124` + beta `computer-use-2025-11-24` for Opus 4.8/4.7/4.6,
  Sonnet 4.6, Opus 4.5; `computer_20250124` for Sonnet 4.5 / Haiku 4.5. Default display is
  1280×800, which keeps screenshot coordinates 1:1 on every model.
- **Browser binary:** run `pnpm exec playwright install chromium` once before a live run.

> Pre-release. The live API path is not yet covered by automated tests (it costs money
> and needs a target); the pure pieces — action parsing, key mapping, tool/model
> resolution, cost accounting — are unit-tested.
