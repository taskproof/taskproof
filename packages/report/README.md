# @taskproof/report

Renders a run into a single self-contained HTML file — the artifact CLAUDE.md calls "the
product": the **matrix** (task × model, pass@k + cost per cell), the **per-run trace**
(agent narration, the actions it took, and the screenshot after each step), the
**deterministic assertion results** (the exact thing that passed or failed), and totals.

`taskproof run` writes a `run-manifest.json` (the graded matrix — it carries the pass@k
thresholds the individual artifacts don't); `taskproof report` feeds that manifest plus the
per-run artifacts here.

```ts
import { buildReportHtml, parseRunManifest } from '@taskproof/report';

const html = buildReportHtml({
  manifest: parseRunManifest(manifestJson),
  artifacts, // RunArtifact[]
  resolveScreenshot: (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`,
});
```

Pure and dependency-light: no DOM, no templating engine, no JS in the output (collapsible
traces use native `<details>`). Screenshots are injected as data URIs so the report is one
portable file. v0 is deliberately plain — legible over pretty.

> Pre-release.
