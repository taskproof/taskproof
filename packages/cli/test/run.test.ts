import type { TaskSpec } from '@taskproof/spec';
import { describe, expect, it } from 'vitest';

import { effectivePolicy, formatReport } from '../src/run.js';

const spec = { passPolicy: { k: 5, minPasses: 4 } } as TaskSpec;

describe('effectivePolicy', () => {
  it('uses the spec policy when there is no override', () => {
    expect(effectivePolicy(spec)).toEqual({ k: 5, minPasses: 4 });
  });

  it('clamps minPasses down to a smaller override k', () => {
    expect(effectivePolicy(spec, 2)).toEqual({ k: 2, minPasses: 2 });
  });

  it('keeps minPasses when the override k is larger', () => {
    expect(effectivePolicy(spec, 10)).toEqual({ k: 10, minPasses: 4 });
  });
});

describe('formatReport', () => {
  it('renders pass/fail marks and a summary line', () => {
    const out = formatReport({
      manifestVersion: '0.1',
      generatedAtMs: 0,
      totalCostUsd: 0.91,
      cells: [
        {
          taskId: 't1',
          goal: 'do a thing',
          model: 'claude-opus-4-8',
          passK: { k: 5, passes: 4, required: 4, passed: true },
          costUsd: 0.61,
          statuses: [],
          runIds: [],
        },
        {
          taskId: 't1',
          goal: 'do a thing',
          model: 'claude-sonnet-4-6',
          passK: { k: 5, passes: 1, required: 4, passed: false },
          costUsd: 0.3,
          statuses: [],
          runIds: [],
        },
      ],
    });
    expect(out).toContain('✓');
    expect(out).toContain('✗');
    expect(out).toContain('1/2 cell(s) passed');
    expect(out).toContain('$0.9100');
  });

  it('shows step count and the failure reason when present', () => {
    const out = formatReport({
      manifestVersion: '0.1',
      generatedAtMs: 0,
      totalCostUsd: 0.84,
      cells: [
        {
          taskId: 'checkout',
          goal: 'buy a t-shirt',
          model: 'browser-use',
          passK: { k: 3, passes: 1, required: 2, passed: false },
          costUsd: 0.3,
          statuses: [],
          runIds: [],
          stepCount: 31,
          failureSummary: 'could not dismiss the entry-ad modal',
        },
      ],
    });
    expect(out).toContain('31 steps');
    expect(out).toContain('↳ could not dismiss the entry-ad modal');
  });
});
