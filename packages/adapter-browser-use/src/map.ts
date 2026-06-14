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

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

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
  const lastIndex = response.steps.length - 1;
  const steps: StepArtifact[] = response.steps.map((step, i): StepArtifact => {
    // browser-use only reports run-level token usage, so attribute it all to the final
    // step and leave earlier steps at zero rather than implying false per-step cost.
    const usage = i === lastIndex ? ctx.tokenUsage : ZERO_USAGE;
    const costUsd = i === lastIndex ? ctx.costUsd : 0;
    return {
      index: step.index,
      ...(step.text !== undefined && step.text !== '' ? { text: step.text } : {}),
      actions: toActions(step, ctx.screenshotPaths.get(step.index)),
      usage: fullUsage(usage, costUsd),
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
