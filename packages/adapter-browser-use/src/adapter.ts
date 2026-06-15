import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CostMeter,
  type Adapter,
  type AdapterConfig,
  type AdapterRunInput,
  type AssertionResult,
  type CostMeterOptions,
  type RunArtifact,
  type RunStatus,
  type TokenUsage,
} from '@taskproof/core';
import { evaluateAssertions } from '@taskproof/grader';

import { SidecarClient } from './client.js';
import { parseSidecarResponse, type SidecarRunRequest } from './contract.js';
import { ADAPTER_NAME, sidecarProbe, toRunArtifact } from './map.js';

export const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8765';
const DEFAULT_DISPLAY = { widthPx: 1280, heightPx: 800 } as const;
// Let the client wait this much past the sidecar's own timeout before giving up, so the
// sidecar's clean timeout artifact wins over the client tearing down the connection. This is
// safe because the sidecar's teardown is itself bounded (KILL_TIMEOUT_S in the sidecar), so its
// total overshoot stays well under this buffer; revisit the two together if either changes.
const CLIENT_TIMEOUT_BUFFER_MS = 30_000;

/** browser-use-specific config layered on the shared {@link AdapterConfig}. */
export interface BrowserUseAdapterConfig extends AdapterConfig {
  /** Base URL of the running sidecar. Falls back to TASKPROOF_BROWSER_USE_URL or the default. */
  sidecarUrl?: string;
}

export function createBrowserUseAdapter(): Adapter {
  return { name: ADAPTER_NAME, run: runBrowserUse };
}

async function runBrowserUse(input: AdapterRunInput, config: AdapterConfig): Promise<RunArtifact> {
  const { spec, runId, signal } = input;
  const sidecarConfig = config as BrowserUseAdapterConfig;
  const baseUrl =
    sidecarConfig.sidecarUrl ?? process.env['TASKPROOF_BROWSER_USE_URL'] ?? DEFAULT_SIDECAR_URL;
  const display = config.display ?? DEFAULT_DISPLAY;
  const startedAtMs = Date.now();

  const request: SidecarRunRequest = {
    goal: spec.goal,
    entryUrl: spec.entryUrl,
    maxSteps: spec.maxSteps,
    model: config.model,
    display: { widthPx: display.widthPx, heightPx: display.heightPx },
    headless: config.headless !== false,
    domSelectors: spec.assertions
      .filter((assertion) => assertion.type === 'dom')
      .map((assertion) => assertion.selector),
    ...(spec.allowedDomains.length > 0 ? { allowedDomains: spec.allowedDomains } : {}),
    // timeoutMs IS enforced by the sidecar (it kills Chromium and returns a clean artifact).
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    // NB: no maxCostUsd — taskproof can't enforce a $ cap mid-run for browser-use (it runs to
    // maxSteps), so we don't send a field that would imply otherwise. maxSteps bounds the run.
  };

  // Abort if the caller cancels OR — as a backstop for a wholly-unresponsive sidecar — past the
  // timeout plus the buffer (see CLIENT_TIMEOUT_BUFFER_MS). We own the timer and clear it in the
  // `finally` so it doesn't linger after a fast run (the CLI is one long-lived process across the
  // whole matrix); `timedOut` lets the catch label this stop 'aborted', not 'error'.
  const timeoutController = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (config.timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, config.timeoutMs + CLIENT_TIMEOUT_BUFFER_MS);
    timeoutHandle.unref();
  }
  const abortSignals: AbortSignal[] = [];
  if (signal) abortSignals.push(signal);
  if (config.timeoutMs !== undefined) abortSignals.push(timeoutController.signal);
  const runSignal = abortSignals.length > 0 ? AbortSignal.any(abortSignals) : undefined;

  try {
    const response = parseSidecarResponse(await new SidecarClient(baseUrl).run(request, runSignal));

    const tokenUsage: TokenUsage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheCreationTokens: response.usage.cacheCreationTokens,
    };
    // Cost from our authoritative MODEL_PRICING when the model is known; otherwise trust
    // the sidecar's estimate (browser-use's own pricing table can lag Anthropic's).
    let costUsd: number;
    try {
      const meterOptions: CostMeterOptions = { model: config.model };
      if (config.pricing !== undefined) meterOptions.pricing = config.pricing;
      costUsd = new CostMeter(meterOptions).record(tokenUsage).costUsd;
    } catch {
      costUsd = response.usage.costUsd;
    }

    const screenshotPaths = new Map<number, string>();
    if (config.artifactsDir !== undefined) {
      const dir = join(config.artifactsDir, runId);
      await mkdir(dir, { recursive: true });
      for (const step of response.steps) {
        if (step.screenshotBase64 !== undefined) {
          const path = join(dir, `step-${step.index}.png`);
          await writeFile(path, Buffer.from(step.screenshotBase64, 'base64'));
          screenshotPaths.set(step.index, path);
        }
      }
    }

    const assertions: AssertionResult[] = await evaluateAssertions(
      spec.assertions,
      sidecarProbe(response),
    );

    return toRunArtifact(response, {
      runId,
      taskId: spec.id,
      model: config.model,
      startedAtMs,
      finishedAtMs: Date.now(),
      assertions,
      tokenUsage,
      costUsd,
      screenshotPaths,
    });
  } catch (error) {
    // A caller cancel or our own client-side timeout is a deliberate stop, not a failure — label
    // it 'aborted' so it matches the Claude adapter (and the sidecar's own timeout artifact),
    // keeping the cross-adapter status vocabulary uniform. Everything else is a real 'error'.
    const aborted =
      signal?.aborted === true ||
      timedOut ||
      (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
    const status: RunStatus = aborted ? 'aborted' : 'error';
    return {
      artifactSchemaVersion: '0.1',
      runId,
      taskId: spec.id,
      adapter: ADAPTER_NAME,
      model: config.model,
      status,
      startedAtMs,
      finishedAtMs: Date.now(),
      steps: [],
      network: [],
      assertions: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
