import Anthropic from '@anthropic-ai/sdk';
import type { JudgeVerdict } from '@taskproof/core';

import {
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM_PROMPT,
  buildJudgePrompt,
  type JudgeInput,
} from './prompt.js';
import { parseVerdict } from './verdict.js';

/**
 * A pluggable LLM completion: given the system + user prompts, return the model's text. Kept
 * abstract so the judge's prompt/parse logic is pure and testable; `createAnthropicJudge`
 * provides the real implementation.
 */
export type Complete = (system: string, user: string) => Promise<string>;

/**
 * Run the LLM judge over one run's evidence and return a verdict stamped with the prompt
 * version. Never throws: an API/parse failure becomes a failing verdict carrying the error, so
 * an unjudgeable run can't silently pass.
 */
export async function judgeRun(input: JudgeInput, complete: Complete): Promise<JudgeVerdict> {
  try {
    const text = await complete(JUDGE_SYSTEM_PROMPT, buildJudgePrompt(input));
    const parsed = parseVerdict(text);
    return { pass: parsed.pass, reasoning: parsed.reasoning, promptVersion: JUDGE_PROMPT_VERSION };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      pass: false,
      reasoning: `judge call failed: ${message}`,
      promptVersion: JUDGE_PROMPT_VERSION,
      error: message,
    };
  }
}

export interface AnthropicJudgeOptions {
  /** Judge model (default claude-opus-4-8). The judge is intentionally separate from the agent's model. */
  model?: string;
  /** API key; defaults to the SDK's env (ANTHROPIC_API_KEY). */
  apiKey?: string;
  maxTokens?: number;
}

/** A `Complete` backed by the Anthropic Messages API. The only impure part of this package. */
export function createAnthropicJudge(options: AnthropicJudgeOptions = {}): Complete {
  const client = new Anthropic(options.apiKey !== undefined ? { apiKey: options.apiKey } : {});
  const model = options.model ?? 'claude-opus-4-8';
  const maxTokens = options.maxTokens ?? 1024;
  return async (system, user) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  };
}
