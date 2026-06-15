import type {
  ActionArtifact,
  AssertionResult,
  NetworkEvent,
  RunArtifact,
  StepArtifact,
  TokenUsage,
} from '@taskproof/core';
import type { DomProbeResult, Probe } from '@taskproof/grader';

import type { SidecarRunResponse } from './contract.js';

export const ADAPTER_NAME = 'browser-use';

/** A grader Probe backed by a sidecar response (url + network from the run, dom from CDP probes). */
export function sidecarProbe(response: SidecarRunResponse): Probe {
  const network: NetworkEvent[] = response.network.map((event) => ({
    url: event.url,
    method: event.method,
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.resourceType !== undefined ? { resourceType: event.resourceType } : {}),
    atMs: event.atMs,
  }));
  return {
    finalUrl: response.finalUrl,
    network,
    dom: (selector: string): Promise<DomProbeResult> => {
      // Page-level readiness (same for every selector) lets the grader reject a vacuous
      // `absent` pass on a blank/failed page.
      const pageReady = response.pageReady !== undefined ? { pageReady: response.pageReady } : {};
      const probe = response.domProbes[selector];
      if (probe === undefined) {
        return Promise.resolve({
          exists: false,
          visible: false,
          text: null,
          error: 'selector was not probed by the sidecar',
          ...pageReady,
        });
      }
      return Promise.resolve({
        exists: probe.exists,
        visible: probe.visible,
        text: probe.text,
        ...(probe.error !== undefined ? { error: probe.error } : {}),
        ...pageReady,
      });
    },
  };
}

/** Fill optional cache fields so the result matches the artifact's required usage shape. */
function fullUsage(usage: TokenUsage, costUsd: number) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
    costUsd,
  };
}

/** Even split of an integer total across `n` slots; the last slot absorbs the remainder. */
function shareInt(total: number, n: number, isLast: boolean): number {
  if (n <= 0) return 0;
  const base = Math.floor(total / n);
  return isLast ? total - base * (n - 1) : base;
}

/** Even split of a float total across `n` slots; the last slot absorbs the rounding remainder. */
function shareFloat(total: number, n: number, isLast: boolean): number {
  if (n <= 0) return 0;
  const each = total / n;
  return isLast ? total - each * (n - 1) : each;
}

/**
 * Per-step usage for browser-use. browser-use reports cost/tokens only at the run level, so we
 * spread the run total evenly across steps (remainder on the last step) — this keeps the trace
 * honest in aggregate (steps sum to the authoritative run-level `usage`) without the misleading
 * spike of dumping the whole run cost on one step. It is an even-split estimate, NOT measured
 * per-step cost; the run-level total is the figure to trust.
 */
function evenStepUsage(total: TokenUsage, totalCostUsd: number, n: number, isLast: boolean) {
  return {
    inputTokens: shareInt(total.inputTokens, n, isLast),
    outputTokens: shareInt(total.outputTokens, n, isLast),
    cacheReadTokens: shareInt(total.cacheReadTokens ?? 0, n, isLast),
    cacheCreationTokens: shareInt(total.cacheCreationTokens ?? 0, n, isLast),
    costUsd: shareFloat(totalCostUsd, n, isLast),
  };
}

export interface MapContext {
  runId: string;
  taskId: string;
  model: string;
  startedAtMs: number;
  finishedAtMs: number;
  assertions: AssertionResult[];
  /** Total token usage for the run (browser-use reports run-level, not per-step). */
  tokenUsage: TokenUsage;
  /** Total cost in USD, computed by the adapter via the shared CostMeter. */
  costUsd: number;
  /** Step index → on-disk screenshot path the adapter already wrote. */
  screenshotPaths: Map<number, string>;
}

function toActions(
  step: SidecarRunResponse['steps'][number],
  screenshotPath: string | undefined,
): ActionArtifact[] {
  const actions: ActionArtifact[] = step.actions.map((action) => ({
    type: action.type,
    raw: action.raw,
    outcome: action.outcome,
    ...(action.error !== undefined ? { error: action.error } : {}),
  }));
  if (screenshotPath !== undefined) {
    // Attach the post-step screenshot to the last action (the resulting state); if the
    // step took no actions, record a synthetic screenshot action so the trace shows it.
    if (actions.length > 0) {
      actions[actions.length - 1] = {
        ...(actions[actions.length - 1] as ActionArtifact),
        screenshotPath,
      };
    } else {
      actions.push({ type: 'screenshot', raw: {}, outcome: 'ok', screenshotPath });
    }
  }
  return actions;
}

/** Map a validated sidecar response into the shared RunArtifact. Pure — no IO. */
export function toRunArtifact(response: SidecarRunResponse, ctx: MapContext): RunArtifact {
  const n = response.steps.length;
  const steps: StepArtifact[] = response.steps.map((step, i): StepArtifact => {
    return {
      index: step.index,
      ...(step.text !== undefined && step.text !== '' ? { text: step.text } : {}),
      actions: toActions(step, ctx.screenshotPaths.get(step.index)),
      usage: evenStepUsage(ctx.tokenUsage, ctx.costUsd, n, i === n - 1),
      ...(step.url !== undefined ? { url: step.url } : {}),
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
    };
  });

  const network: NetworkEvent[] = response.network.map((event) => ({
    url: event.url,
    method: event.method,
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.resourceType !== undefined ? { resourceType: event.resourceType } : {}),
    atMs: event.atMs,
  }));

  return {
    artifactSchemaVersion: '0.1',
    runId: ctx.runId,
    taskId: ctx.taskId,
    adapter: ADAPTER_NAME,
    model: ctx.model,
    status: response.status,
    startedAtMs: ctx.startedAtMs,
    finishedAtMs: ctx.finishedAtMs,
    ...(response.finalUrl !== undefined ? { finalUrl: response.finalUrl } : {}),
    steps,
    network,
    assertions: ctx.assertions,
    usage: fullUsage(ctx.tokenUsage, ctx.costUsd),
    ...(response.error !== undefined ? { error: response.error } : {}),
  };
}
