import { z } from 'zod';

/**
 * A run manifest is what `taskproof run` writes alongside the per-run artifacts: the
 * graded matrix. The report needs it because pass@k requires the spec's threshold, which
 * the individual artifacts don't carry.
 */
export const MANIFEST_VERSION = '0.1';

const passKSchema = z.strictObject({
  k: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  passed: z.boolean(),
});

export const manifestCellSchema = z.strictObject({
  taskId: z.string().min(1),
  goal: z.string(),
  model: z.string().min(1),
  passK: passKSchema,
  costUsd: z.number().nonnegative(),
  statuses: z.array(z.string()).default([]),
  /** runIds of the artifacts (one per pass@k run) backing this cell. */
  runIds: z.array(z.string()).default([]),
});
export type ManifestCell = z.infer<typeof manifestCellSchema>;

export const runManifestSchema = z.strictObject({
  manifestVersion: z.literal(MANIFEST_VERSION),
  generatedAtMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  cells: z.array(manifestCellSchema).default([]),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export function parseRunManifest(value: unknown): RunManifest {
  return runManifestSchema.parse(value);
}

/** Distinct task ids, in first-seen order. */
export function manifestTaskIds(manifest: RunManifest): string[] {
  return [...new Set(manifest.cells.map((cell) => cell.taskId))];
}

/** Distinct model ids, in first-seen order. */
export function manifestModels(manifest: RunManifest): string[] {
  return [...new Set(manifest.cells.map((cell) => cell.model))];
}
