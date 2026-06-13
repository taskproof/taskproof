import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createBrowserUseAdapter } from '@taskproof/adapter-browser-use';
import { createClaudeAdapter } from '@taskproof/adapter-claude';
import type { Adapter, AdapterConfig, RunArtifact } from '@taskproof/core';
import { aggregatePassK, deterministicPass } from '@taskproof/grader';
import { MANIFEST_VERSION, type ManifestCell, type RunManifest } from '@taskproof/report';
import { safeParseTaskSpec, type PassPolicy, type TaskSpec } from '@taskproof/spec';

export interface RunOptions {
  models: string[];
  outDir: string;
  maxCostUsd?: number;
  headed?: boolean;
  /** Override the spec's pass@k `k`. */
  k?: number;
  /** Wall-clock from which to stamp the manifest (defaults to Date.now()). */
  nowMs?: number;
}

/** The effective pass@k policy for a run, applying an optional `k` override. */
export function effectivePolicy(spec: TaskSpec, kOverride?: number): PassPolicy {
  if (kOverride === undefined) return spec.passPolicy;
  return { k: kOverride, minPasses: Math.min(spec.passPolicy.minPasses, kOverride) };
}

export type ProgressFn = (message: string) => void;

export const MANIFEST_FILENAME = 'run-manifest.json';

/**
 * Map a `--models` selector to an adapter + the LLM model it should drive. `browser-use`
 * (or `browser-use:<model>`) selects the browser-use adapter; anything else is a Claude
 * model id for the computer-use adapter (`claude` is shorthand for the default Opus).
 */
export function resolveAdapter(selector: string): { adapter: Adapter; model: string } {
  if (selector === 'browser-use' || selector.startsWith('browser-use:')) {
    const colon = selector.indexOf(':');
    const model = colon === -1 ? 'claude-opus-4-8' : selector.slice(colon + 1);
    return { adapter: createBrowserUseAdapter(), model };
  }
  const model = selector === 'claude' ? 'claude-opus-4-8' : selector;
  return { adapter: createClaudeAdapter(), model };
}

const sanitizeSelector = (selector: string): string => selector.replace(/[^a-z0-9-]/gi, '-');

/** Run each spec across each model, grade with pass@k, write artifacts + a manifest. */
export async function runSpecs(
  files: string[],
  options: RunOptions,
  onProgress: ProgressFn = () => {},
): Promise<RunManifest> {
  const specs: TaskSpec[] = [];
  for (const file of files) {
    const result = safeParseTaskSpec(await readFile(file, 'utf8'), { filename: file });
    if (!result.ok) throw result.error;
    specs.push(result.spec);
  }

  await mkdir(options.outDir, { recursive: true });
  const cells: ManifestCell[] = [];
  let totalCostUsd = 0;
  let counter = 0;

  for (const spec of specs) {
    for (const selector of options.models) {
      const { adapter, model } = resolveAdapter(selector);
      const policy = effectivePolicy(spec, options.k);
      const perRunPassed: boolean[] = [];
      const statuses: string[] = [];
      const runIds: string[] = [];
      let cellCost = 0;
      // The linked (first) run's step count, and why the first failing run failed — both
      // surfaced in the matrix so a cell tells the efficiency + failure story at a glance.
      let stepCount: number | undefined;
      let failureSummary: string | undefined;

      for (let run = 0; run < policy.k; run++) {
        onProgress(`running ${spec.id} / ${selector} (run ${run + 1}/${policy.k})…`);
        const runId = `${spec.id}__${sanitizeSelector(selector)}__run${run}__${++counter}`;
        const config: AdapterConfig = {
          model,
          headless: options.headed !== true,
          artifactsDir: options.outDir,
        };
        if (options.maxCostUsd !== undefined) config.maxCostUsd = options.maxCostUsd;

        const artifact: RunArtifact = await adapter.run({ spec, runId }, config);
        await writeFile(join(options.outDir, `${runId}.json`), JSON.stringify(artifact, null, 2));

        const passed = deterministicPass(artifact.assertions);
        perRunPassed.push(passed);
        statuses.push(artifact.status);
        runIds.push(runId);
        cellCost += artifact.usage.costUsd;
        if (run === 0) stepCount = artifact.steps.length;
        if (!passed && failureSummary === undefined) {
          const failing = artifact.assertions.find((a) => !a.ok);
          failureSummary = failing?.detail ?? artifact.error ?? artifact.status;
        }
        onProgress(
          `  ↳ ${passed ? 'PASS' : 'fail'} (${artifact.status}, ${artifact.steps.length} steps, $${artifact.usage.costUsd.toFixed(4)})`,
        );
      }

      cells.push({
        taskId: spec.id,
        goal: spec.goal,
        model: selector,
        passK: aggregatePassK(perRunPassed, policy),
        costUsd: cellCost,
        statuses,
        runIds,
        ...(stepCount !== undefined ? { stepCount } : {}),
        ...(failureSummary !== undefined ? { failureSummary } : {}),
      });
      totalCostUsd += cellCost;
    }
  }

  const manifest: RunManifest = {
    manifestVersion: MANIFEST_VERSION,
    generatedAtMs: options.nowMs ?? Date.now(),
    totalCostUsd,
    cells,
  };
  await writeFile(join(options.outDir, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Whether every cell met its pass@k threshold. */
export function allPassed(manifest: RunManifest): boolean {
  return manifest.cells.every((cell) => cell.passK.passed);
}

/** Render the matrix as a legible plain-text report. */
export function formatReport(manifest: RunManifest): string {
  const lines: string[] = [];
  let lastTask = '';
  for (const cell of manifest.cells) {
    if (cell.taskId !== lastTask) {
      lines.push(`\n${cell.taskId}`);
      lastTask = cell.taskId;
    }
    const mark = cell.passK.passed ? '✓' : '✗';
    const gate = `pass@${cell.passK.k} ${cell.passK.passes}/${cell.passK.k} (need ${cell.passK.required})`;
    const steps = cell.stepCount !== undefined ? `${cell.stepCount} steps` : '';
    lines.push(
      `  ${mark} ${cell.model.padEnd(20)} ${gate.padEnd(26)} ${steps.padStart(9)}  $${cell.costUsd.toFixed(4)}`,
    );
    if (!cell.passK.passed && cell.failureSummary !== undefined && cell.failureSummary !== '') {
      lines.push(`      ↳ ${cell.failureSummary}`);
    }
  }
  const passedCells = manifest.cells.filter((cell) => cell.passK.passed).length;
  lines.push(
    `\n${passedCells}/${manifest.cells.length} cell(s) passed · total $${manifest.totalCostUsd.toFixed(4)}`,
  );
  return lines.join('\n');
}
