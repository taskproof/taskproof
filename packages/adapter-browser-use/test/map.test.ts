import type { AssertionResult, TokenUsage } from '@taskproof/core';
import { runArtifactSchema } from '@taskproof/core';
import { evaluateAssertions } from '@taskproof/grader';
import type { Assertion } from '@taskproof/spec';
import { describe, expect, it } from 'vitest';

import { parseSidecarResponse } from '../src/contract.js';
import { sidecarProbe, toRunArtifact } from '../src/map.js';

const fixture = {
  status: 'completed',
  finalUrl: 'https://shop.example.com/order/confirmed?id=42',
  steps: [
    {
      index: 0,
      text: 'Adding the backpack to the cart.',
      actions: [{ type: 'click_element_by_index', raw: { index: 3 }, outcome: 'ok' }],
      screenshotBase64: 'AAAA',
      url: 'https://shop.example.com/cart',
      durationMs: 1200,
    },
    {
      index: 1,
      text: 'Order confirmed.',
      actions: [{ type: 'done', raw: { success: true }, outcome: 'ok' }],
      screenshotBase64: 'BBBB',
      url: 'https://shop.example.com/order/confirmed?id=42',
      durationMs: 800,
    },
  ],
  network: [
    {
      url: 'https://shop.example.com/api/orders',
      method: 'POST',
      status: 201,
      resourceType: 'XHR',
      atMs: 4100,
    },
  ],
  domProbes: {
    'h1.confirmation': { exists: true, visible: true, text: 'Thank you for your order' },
  },
  usage: {
    inputTokens: 12000,
    outputTokens: 600,
    cacheReadTokens: 8000,
    cacheCreationTokens: 0,
    costUsd: 0.18,
  },
};

const tokenUsage: TokenUsage = {
  inputTokens: 12000,
  outputTokens: 600,
  cacheReadTokens: 8000,
  cacheCreationTokens: 0,
};

function ctx(assertions: AssertionResult[]) {
  return {
    runId: 'checkout__bu__0',
    taskId: 'checkout',
    model: 'claude-opus-4-8',
    startedAtMs: 1000,
    finishedAtMs: 6000,
    assertions,
    tokenUsage,
    costUsd: 0.21,
    screenshotPaths: new Map<number, string>([
      [0, '/runs/checkout__bu__0/step-0.png'],
      [1, '/runs/checkout__bu__0/step-1.png'],
    ]),
  };
}

describe('parseSidecarResponse', () => {
  it('validates and defaults a well-formed payload', () => {
    const parsed = parseSidecarResponse(fixture);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.usage.inputTokens).toBe(12000);
  });

  it('rejects an unknown status', () => {
    expect(() => parseSidecarResponse({ ...fixture, status: 'flaky' })).toThrow();
  });
});

describe('sidecarProbe', () => {
  it('serves url + network from the response', () => {
    const probe = sidecarProbe(parseSidecarResponse(fixture));
    expect(probe.finalUrl).toContain('/order/confirmed');
    expect(probe.network).toHaveLength(1);
    expect(probe.network[0]?.status).toBe(201);
  });

  it('serves dom results for probed selectors and flags unprobed ones', async () => {
    const probe = sidecarProbe(parseSidecarResponse(fixture));
    const probed = await probe.dom('h1.confirmation');
    expect(probed).toMatchObject({ exists: true, visible: true, text: 'Thank you for your order' });
    const unprobed = await probe.dom('#never-asked');
    expect(unprobed.error).toBeDefined();
  });
});

describe('toRunArtifact (the moat: identical artifact shape)', () => {
  it('produces an artifact that validates against the shared schema', () => {
    const artifact = toRunArtifact(parseSidecarResponse(fixture), ctx([]));
    expect(() => runArtifactSchema.parse(artifact)).not.toThrow();
    expect(artifact.adapter).toBe('browser-use');
    expect(artifact.finalUrl).toContain('/order/confirmed');
  });

  it('attributes run-level token usage to the final step only', () => {
    const artifact = toRunArtifact(parseSidecarResponse(fixture), ctx([]));
    expect(artifact.steps[0]?.usage.inputTokens).toBe(0);
    expect(artifact.steps[0]?.usage.costUsd).toBe(0);
    expect(artifact.steps[1]?.usage.inputTokens).toBe(12000);
    expect(artifact.steps[1]?.usage.costUsd).toBeCloseTo(0.21);
    expect(artifact.usage.inputTokens).toBe(12000);
  });

  it('attaches the post-step screenshot to the last action', () => {
    const artifact = toRunArtifact(parseSidecarResponse(fixture), ctx([]));
    const lastAction = artifact.steps[0]?.actions.at(-1);
    expect(lastAction?.screenshotPath).toBe('/runs/checkout__bu__0/step-0.png');
  });

  it('grades end-to-end through the SHARED grader, just like the Claude adapter', async () => {
    const response = parseSidecarResponse(fixture);
    const assertions: Assertion[] = [
      { type: 'url', pattern: '**/order/confirmed**' },
      { type: 'network', urlPattern: '**/api/orders', method: 'POST', status: '2xx' },
      { type: 'dom', selector: 'h1.confirmation', state: 'text', text: 'Thank you' },
    ];
    const results = await evaluateAssertions(assertions, sidecarProbe(response));
    expect(results.every((r) => r.ok)).toBe(true);
    const artifact = toRunArtifact(response, ctx(results));
    expect(artifact.assertions).toHaveLength(3);
    expect(artifact.assertions.every((a) => a.ok)).toBe(true);
  });
});
