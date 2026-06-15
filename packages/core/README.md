# @taskproof/core

The shared contract every runner adapter implements. Three things live here so the
grader, report generator, and `taskproof diff` never have to branch on which agent
produced a run:

- **The run-artifact schema** (`RunArtifact`) — a Zod-validated, versioned record of a
  single agent run: status, per-step trace (narration + actions + screenshots), network
  log, and token/cost usage. Claude computer use, browser-use, Gemini, and OpenAI all
  serialize to this identical shape. _That uniformity is the moat._
- **The adapter interface** (`Adapter`) — `run(input, config) => Promise<RunArtifact>`.
- **The cost meter** (`CostMeter`) — token→USD accounting with cache-aware pricing and a
  soft per-run budget cap (`wouldExceed()` lets a caller stop before the next turn it can't
  afford; a turn can still overshoot the cap by its own cost since cost is only known once billed).

```ts
import { CostMeter, parseRunArtifact, type Adapter } from '@taskproof/core';

const meter = new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 1.0 });
meter.record({ inputTokens: 2400, outputTokens: 120, cacheReadTokens: 1800 });
if (meter.wouldExceed(estimatedNextTurnCost)) stop('budget_exceeded');
```

> Pre-release; `0.x` artifact-schema versions may break between releases.
