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
  type TokenUsage,
} from '@taskproof/core';
import { evaluateAssertions } from '@taskproof/grader';

import { SidecarClient } from './client.js';
import { parseSidecarResponse, type SidecarRunRequest } from './contract.js';
import { ADAPTER_NAME, sidecarProbe, toRunArtifact } from './map.js';

export const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8765';
const DEFAULT_DISPLAY = { widthPx: 1280, heightPx: 800 } as const;

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
    // NB: no maxCostUsd — taskproof can't enforce a $ cap mid-run for browser-use (it runs to
    // maxSteps), so we don't send a field that would imply otherwise. maxSteps bounds the run.
  };

  try {
    const response = parseSidecarResponse(await new SidecarClient(baseUrl).run(request, signal));

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
    return {
      artifactSchemaVersion: '0.1',
      runId,
      taskId: spec.id,
      adapter: ADAPTER_NAME,
      model: config.model,
      status: 'error',
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
  }
}
