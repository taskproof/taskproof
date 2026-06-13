import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import {
  CostMeter,
  type Adapter,
  type AdapterConfig,
  type AdapterRunInput,
  type ActionArtifact,
  type AssertionResult,
  type CostMeterOptions,
  type NetworkEvent,
  type RunArtifact,
  type RunStatus,
  type StepArtifact,
} from '@taskproof/core';
import { evaluateAssertions, type DomProbeResult } from '@taskproof/grader';
import { chromium, type Page } from 'playwright';

import { parseAction, ActionParseError, type ComputerAction } from './actions.js';
import { capture, executeAction } from './execute.js';
import { DEFAULT_DISPLAY, resolveComputerTool, supportsEffort } from './tool.js';

export const ADAPTER_NAME = 'claude';

/** Claude-specific config knobs layered on the shared {@link AdapterConfig}. */
export interface ClaudeAdapterConfig extends AdapterConfig {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY in the environment. */
  apiKey?: string;
  /** Output effort for the model (computer use does best at "high"/"medium"). */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** Max output tokens per turn. */
  maxTokensPerTurn?: number;
}

const SYSTEM_PROMPT =
  'You are operating a web browser to complete a task on a website. ' +
  'You see the page only through screenshots and act only through the computer tool. ' +
  'After each action, a fresh screenshot is returned — verify the result before the next step. ' +
  'When the task is complete, stop and state briefly that it is done. Do not ask for confirmation.';

function imageBlock(png: Buffer): Anthropic.Beta.BetaImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
  };
}

export function createClaudeAdapter(): Adapter {
  return {
    name: ADAPTER_NAME,
    run: runClaude,
  };
}

async function runClaude(
  input: AdapterRunInput,
  config: ClaudeAdapterConfig,
): Promise<RunArtifact> {
  const { spec, runId, signal } = input;
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    throw new Error(
      'Claude adapter requires an Anthropic API key (config.apiKey or ANTHROPIC_API_KEY)',
    );
  }

  const display = config.display ?? DEFAULT_DISPLAY;
  const tool = resolveComputerTool(config.model);
  // effort 400s on models that don't support it (Haiku 4.5, Sonnet 4.5) — omit it there.
  const effort = config.effort ?? (supportsEffort(config.model) ? 'high' : undefined);
  const maxCostUsd = config.maxCostUsd ?? spec.maxCostUsd;
  // Build options conditionally: exactOptionalPropertyTypes forbids passing `undefined`.
  const meterOptions: CostMeterOptions = { model: config.model };
  if (config.pricing !== undefined) meterOptions.pricing = config.pricing;
  if (maxCostUsd !== undefined) meterOptions.maxCostUsd = maxCostUsd;
  const meter = new CostMeter(meterOptions);
  const client = new Anthropic({ apiKey });

  const startedAtMs = Date.now();
  const network: NetworkEvent[] = [];
  const steps: StepArtifact[] = [];
  let status: RunStatus = 'max_steps';
  let errorMessage: string | undefined;
  let finalUrl: string | undefined;
  let assertions: AssertionResult[] = [];

  const runDir = config.artifactsDir ? join(config.artifactsDir, runId) : undefined;
  if (runDir) await mkdir(runDir, { recursive: true });

  const browser = await chromium.launch({ headless: config.headless ?? true });
  try {
    const context = await browser.newContext({
      viewport: { width: display.widthPx, height: display.heightPx },
    });
    const page = await context.newPage();
    page.on('response', (response) => {
      network.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        resourceType: response.request().resourceType(),
        atMs: Date.now() - startedAtMs,
      });
    });

    await page.goto(spec.entryUrl, { waitUntil: 'domcontentloaded' });

    // Build a concrete literal so it narrows to the right BetaToolUnion member
    // (an object whose `type` is a 2-literal union won't assign to the union).
    const computerTool: Anthropic.Beta.BetaToolUnion =
      tool.toolType === 'computer_20251124'
        ? {
            type: 'computer_20251124',
            name: 'computer',
            display_width_px: display.widthPx,
            display_height_px: display.heightPx,
            display_number: 1,
          }
        : {
            type: 'computer_20250124',
            name: 'computer',
            display_width_px: display.widthPx,
            display_height_px: display.heightPx,
            display_number: 1,
          };

    const initialShot = await capture(page);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Task: ${spec.goal}\n\n` +
              `You are starting at ${spec.entryUrl}. A screenshot of the current page follows. ` +
              `Complete the task using the computer tool.`,
          },
          imageBlock(initialShot),
        ],
      },
    ];

    for (let stepIndex = 0; stepIndex < spec.maxSteps; stepIndex++) {
      if (signal?.aborted) {
        status = 'aborted';
        break;
      }

      const turnStart = Date.now();
      const response = await client.beta.messages.create({
        model: config.model,
        max_tokens: config.maxTokensPerTurn ?? 4096,
        system: SYSTEM_PROMPT,
        tools: [computerTool],
        messages,
        betas: [tool.betaHeader],
        ...(effort !== undefined ? { output_config: { effort } } : {}),
      });

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      const { costUsd } = meter.record(usage);

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      const toolUses = response.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
      );

      messages.push({ role: 'assistant', content: response.content });

      const stepActions: ActionArtifact[] = [];

      // No tool calls means the agent considers the task finished.
      if (toolUses.length === 0) {
        steps.push(
          makeStep(
            stepIndex,
            text,
            stepActions,
            usage,
            costUsd,
            page.url(),
            response.stop_reason,
            turnStart,
          ),
        );
        status = 'completed';
        break;
      }

      // The agent acted, but we've now spent past the cap — stop before paying for another turn.
      if (meter.maxCostUsd !== undefined && meter.totalUsd > meter.maxCostUsd) {
        steps.push(
          makeStep(
            stepIndex,
            text,
            stepActions,
            usage,
            costUsd,
            page.url(),
            response.stop_reason,
            turnStart,
          ),
        );
        status = 'budget_exceeded';
        break;
      }

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (let i = 0; i < toolUses.length; i++) {
        const block = toolUses[i] as Anthropic.Beta.BetaToolUseBlock;
        const rawInput = (block.input ?? {}) as Record<string, unknown>;
        const record = await applyAction(page, rawInput, tool.supportsZoom, runDir, stepIndex, i);
        stepActions.push(record.artifact);
        toolResults.push(
          record.error === undefined
            ? {
                type: 'tool_result',
                tool_use_id: block.id,
                content: [imageBlock(record.png as Buffer)],
              }
            : {
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${record.error}`,
                is_error: true,
              },
        );
      }

      steps.push(
        makeStep(
          stepIndex,
          text,
          stepActions,
          usage,
          costUsd,
          page.url(),
          response.stop_reason,
          turnStart,
        ),
      );
      messages.push({ role: 'user', content: toolResults });
    }

    finalUrl = page.url();
    // Evaluate the spec's deterministic assertions against the live page (dom visibility
    // needs layout) before the browser closes; embed the results in the artifact.
    assertions = await evaluateAssertions(spec.assertions, {
      finalUrl,
      network,
      dom: (selector) => domProbe(page, selector),
    });
  } catch (error) {
    status = 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await browser.close();
  }

  const finishedAtMs = Date.now();
  const totals = meter.totals;
  return {
    artifactSchemaVersion: '0.1',
    runId,
    taskId: spec.id,
    adapter: ADAPTER_NAME,
    model: config.model,
    status,
    startedAtMs,
    finishedAtMs,
    ...(finalUrl !== undefined ? { finalUrl } : {}),
    steps,
    network,
    assertions,
    usage: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      costUsd: meter.totalUsd,
    },
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
  };
}

/** Inspect a CSS selector against the live page for the grader's dom assertions. */
async function domProbe(page: Page, selector: string): Promise<DomProbeResult> {
  try {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) return { exists: false, visible: false, text: null };
    const first = locator.first();
    const visible = await first.isVisible();
    const text = (await first.textContent()) ?? '';
    return { exists: true, visible, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exists: false, visible: false, text: null, error: message };
  }
}

interface AppliedAction {
  artifact: ActionArtifact;
  png?: Buffer;
  error?: string;
}

async function applyAction(
  page: Page,
  rawInput: Record<string, unknown>,
  supportsZoom: boolean,
  runDir: string | undefined,
  stepIndex: number,
  actionIndex: number,
): Promise<AppliedAction> {
  let action: ComputerAction;
  try {
    action = parseAction(rawInput);
  } catch (error) {
    const message = error instanceof ActionParseError ? error.message : String(error);
    const actionName = typeof rawInput['action'] === 'string' ? rawInput['action'] : 'unknown';
    return {
      artifact: { type: actionName, raw: rawInput, outcome: 'error', error: message },
      error: message,
    };
  }

  if (action.type === 'zoom' && !supportsZoom) {
    const message = 'zoom is not supported by this model';
    return {
      artifact: { type: 'zoom', raw: rawInput, outcome: 'error', error: message },
      error: message,
    };
  }

  try {
    await executeAction(page, action);
    const png = await capture(page, action.type === 'zoom' ? action.region : undefined);
    let screenshotPath: string | undefined;
    if (runDir) {
      screenshotPath = join(runDir, `step-${stepIndex}-act-${actionIndex}.png`);
      await writeFile(screenshotPath, png);
    }
    return {
      artifact: {
        type: action.type,
        raw: rawInput,
        outcome: 'ok',
        ...(screenshotPath !== undefined ? { screenshotPath } : {}),
      },
      png,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      artifact: { type: action.type, raw: rawInput, outcome: 'error', error: message },
      error: message,
    };
  }
}

function makeStep(
  index: number,
  text: string,
  actions: ActionArtifact[],
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  },
  costUsd: number,
  url: string,
  stopReason: string | null,
  turnStart: number,
): StepArtifact {
  return {
    index,
    ...(text !== '' ? { text } : {}),
    actions,
    usage: { ...usage, costUsd },
    ...(url !== '' ? { url } : {}),
    ...(stopReason !== null ? { stopReason } : {}),
    durationMs: Date.now() - turnStart,
  };
}
