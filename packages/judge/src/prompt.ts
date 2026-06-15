/**
 * The versioned LLM-judge prompt. Bump JUDGE_PROMPT_VERSION on any change to the system
 * prompt or the evidence format, and re-run the golden-set eval (see README) — the version is
 * recorded on every verdict so a graded run is reproducible against the exact rubric used.
 *
 * Recipe (after Online-Mind2Web / WebJudge, arXiv 2504.01382): give the judge the goal, an
 * explicit success rubric, the agent's trajectory, and the deterministic checks that already
 * passed, then ask for an evidence-grounded pass/fail. Screenshot/key-frame evidence is the
 * next iteration; v1 judges from the text trajectory + final URL + assertion results.
 */
export const JUDGE_PROMPT_VERSION = '2026-06-15.2';

export interface JudgeStep {
  index: number;
  text?: string;
  /** Normalized action types this step took, e.g. ["left_click", "type"]. */
  actions: string[];
  url?: string;
}

export interface JudgeAssertion {
  type: string;
  ok: boolean;
  detail: string;
}

export interface JudgeInput {
  /** The task goal handed to the agent. */
  goal: string;
  /** Explicit success criteria from the spec's `judge` field; falls back to the goal. */
  rubric?: string;
  finalUrl?: string;
  steps: JudgeStep[];
  /** Deterministic assertion results (the judge runs only after these pass). */
  assertions: JudgeAssertion[];
}

export const JUDGE_SYSTEM_PROMPT = `You are a strict evaluator deciding whether a web-automation agent ACTUALLY ACCOMPLISHED a task — not merely whether it tried.

You are given: the task goal, explicit success criteria, the agent's step-by-step trajectory (its narration and the action types it took), the final page URL, and deterministic checks that already passed. The deterministic checks are necessary but may be insufficient (e.g. a URL matched but the real objective wasn't met) — that is exactly why you are being asked.

Rules:
- Base your verdict ONLY on the evidence provided. Do not assume steps that aren't shown.
- Be skeptical of the agent's own claims of success; require the trajectory to support them.
- If the evidence is insufficient to CONFIRM the success criteria were met, answer "fail".
- Ignore minor cosmetic deviations; judge whether the criteria were genuinely satisfied.

Respond with ONLY a single JSON object and nothing else:
{"verdict": "pass" | "fail", "reason": "<one or two sentences citing the specific evidence>"}

Any response that is not a single clean JSON object — extra prose, multiple objects, or a contradiction — is treated as a FAIL.`;

/** Build the user-message evidence prompt for a single run. */
export function buildJudgePrompt(input: JudgeInput): string {
  const lines: string[] = [];
  lines.push(`Task goal: ${input.goal}`);
  lines.push(
    `Success criteria: ${input.rubric && input.rubric.trim() !== '' ? input.rubric : 'The task goal above was genuinely accomplished.'}`,
  );
  lines.push(`Final URL: ${input.finalUrl ?? '(none recorded)'}`);

  lines.push('', 'Deterministic checks (already passed):');
  if (input.assertions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of input.assertions) {
      lines.push(`- [${a.ok ? 'ok' : 'FAIL'}] ${a.type}: ${a.detail}`);
    }
  }

  lines.push('', 'Agent trajectory:');
  if (input.steps.length === 0) {
    lines.push('- (no steps recorded)');
  } else {
    for (const s of input.steps) {
      const actions = s.actions.length > 0 ? ` [actions: ${s.actions.join(', ')}]` : '';
      const where = s.url ? ` (at ${s.url})` : '';
      const narration = s.text && s.text.trim() !== '' ? s.text.trim() : '(no narration)';
      lines.push(`${s.index + 1}. ${narration}${actions}${where}`);
    }
  }

  return lines.join('\n');
}
