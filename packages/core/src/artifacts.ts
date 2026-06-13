import { z } from 'zod';

/**
 * The uniform artifact schema every adapter emits. This is the product's moat: a
 * Claude run, a browser-use run, and a Gemini run all serialize to the *same* shape,
 * so the grader, report, and diff never branch on which agent produced a run.
 */
export const ARTIFACT_SCHEMA_VERSION = '0.1';

/** Why a run stopped. Pass/fail is decided later by assertions, not here. */
export const runStatusSchema = z.enum([
  'completed', // the agent ended its own turn (it believes it is done)
  'max_steps', // hit the task's step cap
  'budget_exceeded', // hit the --max-cost / maxCostUsd cap
  'aborted', // cancelled via AbortSignal
  'error', // adapter/runtime/API failure
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

const usageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative(),
});
export type UsageArtifact = z.infer<typeof usageSchema>;

/** One concrete action the agent took (e.g. a computer-use click), with its outcome. */
export const actionArtifactSchema = z.strictObject({
  /** Normalized action type, e.g. "left_click", "type", "screenshot". */
  type: z.string().min(1),
  /** The raw action payload as the vendor emitted it, for replay/debugging. */
  raw: z.record(z.string(), z.unknown()).default({}),
  outcome: z.enum(['ok', 'error']),
  /** Repo-relative or absolute path to the screenshot captured after this action. */
  screenshotPath: z.string().optional(),
  error: z.string().optional(),
});
export type ActionArtifact = z.infer<typeof actionArtifactSchema>;

/** One agent turn: a single model call, the actions it requested, and their results. */
export const stepArtifactSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  /** The agent's natural-language narration this turn, if any. */
  text: z.string().optional(),
  actions: z.array(actionArtifactSchema).default([]),
  usage: usageSchema,
  /** Page URL after this turn's actions were applied. */
  url: z.url().optional(),
  /** Vendor stop reason for this turn (e.g. "tool_use", "end_turn"). */
  stopReason: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type StepArtifact = z.infer<typeof stepArtifactSchema>;

/** Outcome of evaluating one deterministic assertion against the final run state. */
export const assertionResultSchema = z.strictObject({
  type: z.enum(['url', 'dom', 'network']),
  ok: z.boolean(),
  /** Human-readable explanation: what was checked and what was observed. */
  detail: z.string(),
  /** Echo of the assertion's `description`, if it had one. */
  description: z.string().optional(),
});
export type AssertionResult = z.infer<typeof assertionResultSchema>;

/** A network request observed during the run (drives `network` assertions later). */
export const networkEventSchema = z.strictObject({
  url: z.string().min(1),
  method: z.string().min(1),
  status: z.number().int().optional(),
  resourceType: z.string().optional(),
  /** Milliseconds since the run started. */
  atMs: z.number().nonnegative(),
});
export type NetworkEvent = z.infer<typeof networkEventSchema>;

export const runArtifactSchema = z.strictObject({
  artifactSchemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  /** Adapter name, e.g. "claude", "browser-use". */
  adapter: z.string().min(1),
  model: z.string().min(1),
  status: runStatusSchema,
  startedAtMs: z.number().nonnegative(),
  finishedAtMs: z.number().nonnegative(),
  finalUrl: z.url().optional(),
  steps: z.array(stepArtifactSchema).default([]),
  network: z.array(networkEventSchema).default([]),
  /** Deterministic assertion outcomes, evaluated against the final state at end-of-run. */
  assertions: z.array(assertionResultSchema).default([]),
  usage: usageSchema,
  /** Populated when status is "error". */
  error: z.string().optional(),
});
export type RunArtifact = z.infer<typeof runArtifactSchema>;

/** Validate and normalize an artifact (applies defaults). Throws on invalid input. */
export function parseRunArtifact(value: unknown): RunArtifact {
  return runArtifactSchema.parse(value);
}
