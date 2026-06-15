import type { TaskSpec } from '@taskproof/spec';

import type { ModelPricing } from './cost.js';
import type { RunArtifact } from './artifacts.js';

/** What the caller hands an adapter for a single run of one task. */
export interface AdapterRunInput {
  spec: TaskSpec;
  /** Stable identifier for this run; echoed into the artifact. */
  runId: string;
  /** Cancels the run cooperatively (e.g. an overall wall-clock deadline). */
  signal?: AbortSignal;
}

/** Vendor-agnostic knobs every adapter accepts. Adapter-specific options extend this. */
export interface AdapterConfig {
  /** Model id to drive the agent (e.g. "claude-opus-4-8"). */
  model: string;
  /**
   * Soft per-run budget cap in USD. Falls back to the spec's `maxCostUsd`. Claude stops before a
   * turn it can't afford (overshoot ≤1 turn); browser-use is bounded by `maxSteps`, not cost.
   */
  maxCostUsd?: number;
  /** Run the browser headless (default true in CI). */
  headless?: boolean;
  /** Virtual display the agent sees and clicks within. */
  display?: { widthPx: number; heightPx: number };
  /** Explicit pricing for models absent from the published table. */
  pricing?: ModelPricing;
  /** Directory to write screenshots and other per-run artifacts into. */
  artifactsDir?: string;
  /**
   * Wall-clock cap for a single run, in milliseconds. Claude stops the step loop past the
   * deadline; browser-use enforces it inside the sidecar (which kills Chromium and returns a
   * clean artifact) so an over-long run can't orphan the browser or wedge the sidecar lock.
   */
  timeoutMs?: number;
}

/**
 * The runner contract. Every adapter — Claude computer use, browser-use, Gemini,
 * OpenAI — implements this and emits the identical {@link RunArtifact}. That
 * uniformity is what lets the grader and report stay vendor-neutral.
 */
export interface Adapter {
  /** Stable adapter name recorded in artifacts (e.g. "claude"). */
  readonly name: string;
  run(input: AdapterRunInput, config: AdapterConfig): Promise<RunArtifact>;
}
