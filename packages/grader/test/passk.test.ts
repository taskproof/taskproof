import { describe, expect, it } from 'vitest';

import { aggregatePassK } from '../src/index.js';

describe('aggregatePassK', () => {
  it('passes when passes meet the threshold', () => {
    const result = aggregatePassK([true, true, false, true, true], { k: 5, minPasses: 4 });
    expect(result).toEqual({ k: 5, passes: 4, required: 4, passed: true });
  });

  it('fails when passes fall short of the threshold', () => {
    const result = aggregatePassK([true, false, false], { k: 3, minPasses: 2 });
    expect(result.passed).toBe(false);
    expect(result.passes).toBe(1);
  });

  it('handles the k=1 single-run case', () => {
    expect(aggregatePassK([true], { k: 1, minPasses: 1 }).passed).toBe(true);
    expect(aggregatePassK([false], { k: 1, minPasses: 1 }).passed).toBe(false);
  });
});
