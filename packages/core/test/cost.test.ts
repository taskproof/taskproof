import { describe, expect, it } from 'vitest';

import { BudgetExceededError, CostMeter, getModelPricing, priceUsage } from '../src/index.js';

describe('priceUsage', () => {
  const pricing = { inputPerMTok: 5, outputPerMTok: 25 };

  it('prices plain input and output at the base rates', () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    expect(priceUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, pricing)).toBeCloseTo(
      30,
    );
  });

  it('discounts cache reads to 0.1x and surcharges cache writes to 1.25x', () => {
    const cost = priceUsage(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
      },
      pricing,
    );
    // (1M*0.1 + 1M*1.25) tokens billed at $5/M = (100k + 1.25M)/1M * 5 = $6.75
    expect(cost).toBeCloseTo(6.75);
  });

  it('is zero for zero usage', () => {
    expect(priceUsage({ inputTokens: 0, outputTokens: 0 }, pricing)).toBe(0);
  });
});

describe('getModelPricing', () => {
  it('knows the computer-use models', () => {
    expect(getModelPricing('claude-opus-4-8')).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
    expect(getModelPricing('claude-sonnet-4-6')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });

  it('returns undefined for unknown models', () => {
    expect(getModelPricing('gpt-9')).toBeUndefined();
  });
});

describe('CostMeter', () => {
  it('resolves pricing from a known model', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8' });
    expect(meter.pricing).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
  });

  it('throws for an unknown model with no explicit pricing', () => {
    expect(() => new CostMeter({ model: 'mystery-model' })).toThrowError(/no published pricing/);
  });

  it('accepts explicit pricing for an unknown model', () => {
    const meter = new CostMeter({
      model: 'mystery-model',
      pricing: { inputPerMTok: 2, outputPerMTok: 8 },
    });
    expect(meter.pricing.inputPerMTok).toBe(2);
  });

  it('accumulates cost and token totals across turns', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8' });
    const first = meter.record({ inputTokens: 1_000_000, outputTokens: 0 }); // $5
    expect(first.costUsd).toBeCloseTo(5);
    expect(first.totalUsd).toBeCloseTo(5);
    const second = meter.record({ inputTokens: 0, outputTokens: 1_000_000 }); // $25
    expect(second.costUsd).toBeCloseTo(25);
    expect(meter.totalUsd).toBeCloseTo(30);
    expect(meter.totals.inputTokens).toBe(1_000_000);
    expect(meter.totals.outputTokens).toBe(1_000_000);
  });

  it('reports remaining budget and soft-checks the cap', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 10 });
    meter.record({ inputTokens: 1_000_000, outputTokens: 0 }); // $5
    expect(meter.remainingUsd()).toBeCloseTo(5);
    expect(meter.wouldExceed(4)).toBe(false);
    expect(meter.wouldExceed(6)).toBe(true);
  });

  it('clamps remaining budget at zero once over the cap', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 1 });
    meter.record({ inputTokens: 1_000_000, outputTokens: 0 }); // $5 > $1
    expect(meter.remainingUsd()).toBe(0);
  });

  it('enforce() throws only once the cap is exceeded', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 10 });
    meter.record({ inputTokens: 1_000_000, outputTokens: 0 }); // $5
    expect(() => meter.enforce()).not.toThrow();
    meter.record({ inputTokens: 0, outputTokens: 1_000_000 }); // +$25 -> $30
    expect(() => meter.enforce()).toThrowError(BudgetExceededError);
  });

  it('never enforces without a cap', () => {
    const meter = new CostMeter({ model: 'claude-opus-4-8' });
    meter.record({ inputTokens: 100_000_000, outputTokens: 100_000_000 });
    expect(() => meter.enforce()).not.toThrow();
    expect(meter.remainingUsd()).toBeUndefined();
  });

  it('rejects a NaN / Infinity / negative cap (no silently-unbounded run)', () => {
    // A NaN cap would make every `> cap` comparison false, silently disabling the budget.
    expect(() => new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: Number.NaN })).toThrow();
    expect(() => new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: Infinity })).toThrow();
    expect(() => new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: -1 })).toThrow();
    expect(() => new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 0 })).not.toThrow();
    expect(() => new CostMeter({ model: 'claude-opus-4-8', maxCostUsd: 2.5 })).not.toThrow();
  });
});
