import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createClaudeAdapter, type ClaudeAdapterConfig } from '@taskproof/adapter-claude';
import type { RunArtifact } from '@taskproof/core';
import { aggregatePassK, deterministicPass, type PassKResult } from '@taskproof/grader';
import { safeParseTaskSpec, type PassPolicy, type TaskSpec } from '@taskproof/spec';

export interface RunOptions {
  models: string[];
  outDir: string;
  maxCostUsd?: number;
  headed?: boolean;
  /** Override the spec's pass@k `k`. */
  k?: number;
}

export interface RunCell {
  taskId: string;
  model: string;
  passK: PassKResult;
  costUsd: number;
  statuses: string[];
}

export interface RunReport {
  cells: RunCell[];
  totalCostUsd: number;
  allPassed: boolean;
}

/** The effective pass@k policy for a run, applying an optional `k` override. */
export function effectivePolicy(spec: TaskSpec, kOverride?: number): PassPolicy {
  if (kOverride === undefined) return spec.passPolicy;
  return { k: kOverride, minPasses: Math.min(spec.passPolicy.minPasses, kOverride) };
}

export type ProgressFn = (message: string) => void;

/** Run each spec across each model, grade with pass@k, and collect the matrix. */
export async function runSpecs(
  files: string[],
  options: RunOptions,
  onProgress: ProgressFn = () => {},
): Promise<RunReport> {
  const specs: TaskSpec[] = [];
  for (const file of files) {
    const result = safeParseTaskSpec(await readFile(file, 'utf8'), { filename: file });
    if (!result.ok) throw result.error;
    specs.push(result.spec);
  }

  await mkdir(options.outDir, { recursive: true });
  const adapter = createClaudeAdapter();
  const cells: RunCell[] = [];
  let totalCostUsd = 0;
  let counter = 0;

  for (const spec of specs) {
    for (const model of options.models) {
      const policy = effectivePolicy(spec, options.k);
      const perRunPassed: boolean[] = [];
      const statuses: string[] = [];
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
        cellCost += artifact.usage.costUsd;
        onProgress(
          `  ↳ ${passed ? 'PASS' : 'fail'} (${artifact.status}, ${artifact.steps.length} steps, $${artifact.usage.costUsd.toFixed(4)})`,
        );
      }

      cells.push({
        taskId: spec.id,
        model,
        passK: aggregatePassK(perRunPassed, policy),
        costUsd: cellCost,
        statuses,
      });
      totalCostUsd += cellCost;
    }
  }

  return { cells, totalCostUsd, allPassed: cells.every((cell) => cell.passK.passed) };
}

/** Render the matrix as a legible plain-text report. */
export function formatReport(report: RunReport): string {
  const lines: string[] = [];
  let lastTask = '';
  for (const cell of report.cells) {
    if (cell.taskId !== lastTask) {
      lines.push(`\n${cell.taskId}`);
      lastTask = cell.taskId;
    }
    const mark = cell.passK.passed ? '✓' : '✗';
    const gate = `pass@${cell.passK.k} ${cell.passK.passes}/${cell.passK.k} (need ${cell.passK.required})`;
    lines.push(`  ${mark} ${cell.model.padEnd(20)} ${gate.padEnd(28)} $${cell.costUsd.toFixed(4)}`);
  }
  const passedCells = report.cells.filter((cell) => cell.passK.passed).length;
  lines.push(
    `\n${passedCells}/${report.cells.length} cell(s) passed · total $${report.totalCostUsd.toFixed(4)}`,
  );
  return lines.join('\n');
}
