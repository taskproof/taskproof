import { z } from 'zod';

/**
 * The HTTP contract between this adapter and the Python/FastAPI sidecar. The sidecar runs
 * browser-use and reports raw run data + probe results; this adapter maps that into the
 * shared RunArtifact and grades via the shared grader. The sidecar never sees the spec
 * schema or the artifact version — only task primitives + the dom selectors to probe.
 */

export interface SidecarRunRequest {
  goal: string;
  entryUrl: string;
  maxSteps: number;
  /** Claude model id browser-use drives as its LLM (e.g. "claude-opus-4-8"). */
  model: string;
  display: { widthPx: number; heightPx: number };
  headless: boolean;
  /** CSS selectors from the spec's dom assertions, probed against the final page. */
  domSelectors: string[];
  allowedDomains?: string[];
  /**
   * Wall-clock cap in ms. The sidecar REALLY enforces this (asyncio.wait_for kills Chromium and
   * returns a clean artifact) — unlike a $ budget, a time limit IS enforceable mid-run, so this
   * field is honest. Omitted → the sidecar's generous default.
   */
  timeoutMs?: number;
  // No maxCostUsd: a $ budget can't be enforced mid-run for browser-use (it runs to maxSteps),
  // so the contract doesn't accept a field that would falsely imply enforcement.
}

const sidecarActionSchema = z.object({
  type: z.string(),
  raw: z.record(z.string(), z.unknown()).default({}),
  outcome: z.enum(['ok', 'error']).default('ok'),
  screenshotBase64: z.string().optional(),
  error: z.string().optional(),
});

const sidecarStepSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().optional(),
  actions: z.array(sidecarActionSchema).default([]),
  /** Post-step screenshot (PNG base64); written to disk by the adapter. */
  screenshotBase64: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
});

const sidecarNetworkSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().int().optional(),
  resourceType: z.string().optional(),
  atMs: z.number().nonnegative(),
});

const sidecarDomProbeSchema = z.object({
  exists: z.boolean(),
  visible: z.boolean(),
  text: z.string().nullable(),
  error: z.string().optional(),
});

const sidecarUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  /** The sidecar's own cost estimate; the adapter recomputes from tokens via CostMeter. */
  costUsd: z.number().nonnegative().default(0),
});

export const sidecarRunResponseSchema = z.object({
  status: z.enum(['completed', 'max_steps', 'budget_exceeded', 'aborted', 'error']),
  finalUrl: z.string().optional(),
  /** Whether the final page rendered real content (body has children); guards `absent`. */
  pageReady: z.boolean().optional(),
  steps: z.array(sidecarStepSchema).default([]),
  network: z.array(sidecarNetworkSchema).default([]),
  domProbes: z.record(z.string(), sidecarDomProbeSchema).default({}),
  usage: sidecarUsageSchema.default({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  }),
  error: z.string().optional(),
});

export type SidecarRunResponse = z.infer<typeof sidecarRunResponseSchema>;
export type SidecarStep = z.infer<typeof sidecarStepSchema>;

/** Parse and validate a raw sidecar response. Throws on a malformed payload. */
export function parseSidecarResponse(value: unknown): SidecarRunResponse {
  return sidecarRunResponseSchema.parse(value);
}
