import { describe, expect, it } from 'vitest';

import {
  GOLDEN_CASES,
  JUDGE_PROMPT_VERSION,
  buildJudgePrompt,
  judgeRun,
  parseVerdict,
  type JudgeInput,
} from '../src/index.js';

describe('parseVerdict (golden set)', () => {
  // The deterministic regression: every golden response parses to its labeled verdict.
  for (const c of GOLDEN_CASES) {
    it(`parses "${c.name}" → ${c.expectPass ? 'pass' : 'fail'}`, () => {
      expect(parseVerdict(c.response).pass).toBe(c.expectPass);
    });
  }

  it('fails safe (never passes) on an unrecoverable response', () => {
    const v = parseVerdict('total nonsense with no verdict at all');
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('no parseable JSON verdict');
  });
});

const sample: JudgeInput = {
  goal: 'Buy a t-shirt and reach the order-complete page.',
  rubric: 'The order was placed and the confirmation is shown.',
  finalUrl: 'https://shop.example/checkout-complete',
  steps: [{ index: 0, text: 'Logged in and checked out.', actions: ['left_click', 'type'] }],
  assertions: [{ type: 'url', ok: true, detail: 'final URL matched **/checkout-complete' }],
};

describe('buildJudgePrompt', () => {
  it('includes the goal, rubric, final URL, deterministic checks, and trajectory', () => {
    const p = buildJudgePrompt(sample);
    expect(p).toContain('Buy a t-shirt');
    expect(p).toContain('The order was placed');
    expect(p).toContain('https://shop.example/checkout-complete');
    expect(p).toContain('url: final URL matched **/checkout-complete');
    expect(p).toContain('Logged in and checked out.');
    expect(p).toContain('actions: left_click, type');
  });

  it('falls back to the goal when no rubric is given', () => {
    const p = buildJudgePrompt({
      goal: 'Do the thing.',
      finalUrl: 'https://shop.example/done',
      steps: [{ index: 0, actions: ['left_click'] }],
      assertions: [{ type: 'url', ok: true, detail: 'matched' }],
    });
    expect(p).toContain('genuinely accomplished');
  });
});

describe('judgeRun', () => {
  it('stamps the prompt version and maps a passing response', async () => {
    const verdict = await judgeRun(sample, () =>
      Promise.resolve({ text: '{"verdict":"pass","reason":"done"}' }),
    );
    expect(verdict).toEqual({
      pass: true,
      reasoning: 'done',
      promptVersion: JUDGE_PROMPT_VERSION,
      costUsd: 0,
    });
  });

  it('propagates the judge call cost and model onto the verdict', async () => {
    const verdict = await judgeRun(sample, () =>
      Promise.resolve({ text: '{"verdict":"pass"}', costUsd: 0.012, model: 'claude-opus-4-8' }),
    );
    expect(verdict.costUsd).toBe(0.012);
    expect(verdict.model).toBe('claude-opus-4-8');
  });

  it('turns a thrown completion into a failing, error-carrying verdict (fails safe)', async () => {
    const verdict = await judgeRun(sample, () => Promise.reject(new Error('429 rate limited')));
    expect(verdict.pass).toBe(false);
    expect(verdict.error).toContain('429');
    expect(verdict.costUsd).toBe(0);
    expect(verdict.promptVersion).toBe(JUDGE_PROMPT_VERSION);
  });

  it('passes the system + evidence prompts to the completion', async () => {
    let seenSystem = '';
    let seenUser = '';
    await judgeRun(sample, (system, user) => {
      seenSystem = system;
      seenUser = user;
      return Promise.resolve({ text: '{"verdict":"fail","reason":"x"}' });
    });
    expect(seenSystem).toContain('strict evaluator');
    expect(seenUser).toContain('Buy a t-shirt');
  });
});
