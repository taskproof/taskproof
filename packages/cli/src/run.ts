import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createClaudeAdapter, type ClaudeAdapterConfig } from '@taskproof/adapter-claude';
import type { RunArtifact } from '@taskproof/core';
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
  const adapter = createClaudeAdapter();
  const cells: ManifestCell[] = [];
  let totalCostUsd = 0;
  let counter = 0;

  for (const spec of specs) {
    for (const model of options.models) {
      const policy = effectivePolicy(spec, options.k);
      const perRunPassed: boolean[] = [];
      const statuses: string[] = [];
      const runIds: string[] = [];
      let cellCost = 0;

      for (let run = 0; run < policy.k; run++) {
        onProgress(`running ${spec.id} / ${model} (run ${run + 1}/${policy.k})…`);
        const runId = `${spec.id}__${model}__run${run}__${++counter}`;
        const config: ClaudeAdapterConfig = {
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
        onProgress(
          `  ↳ ${passed ? 'PASS' : 'fail'} (${artifact.status}, ${artifact.steps.length} steps, $${artifact.usage.costUsd.toFixed(4)})`,
        );
      }

      cells.push({
        taskId: spec.id,
        goal: spec.goal,
        model,
        passK: aggregatePassK(perRunPassed, policy),
        costUsd: cellCost,
        statuses,
        runIds,
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
    lines.push(`  ${mark} ${cell.model.padEnd(20)} ${gate.padEnd(28)} $${cell.costUsd.toFixed(4)}`);
  }
  const passedCells = manifest.cells.filter((cell) => cell.passK.passed).length;
  lines.push(
    `\n${passedCells}/${manifest.cells.length} cell(s) passed · total $${manifest.totalCostUsd.toFixed(4)}`,
  );
  return lines.join('\n');
}
