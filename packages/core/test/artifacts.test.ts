import { describe, expect, it } from 'vitest';

import { ARTIFACT_SCHEMA_VERSION, parseRunArtifact, runArtifactSchema } from '../src/index.js';

function baseArtifact() {
  return {
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    runId: 'run-1',
    taskId: 'checkout-tshirt',
    adapter: 'claude',
    model: 'claude-opus-4-8',
    status: 'completed' as const,
    startedAtMs: 1000,
    finishedAtMs: 5000,
    usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
  };
}

describe('runArtifactSchema', () => {
  it('parses a minimal artifact and applies array/usage defaults', () => {
    const artifact = parseRunArtifact(baseArtifact());
    expect(artifact.steps).toEqual([]);
    expect(artifact.network).toEqual([]);
    expect(artifact.usage.cacheReadTokens).toBe(0);
    expect(artifact.usage.cacheCreationTokens).toBe(0);
  });

  it('parses a full artifact with steps, actions, and network events', () => {
    const artifact = parseRunArtifact({
      ...baseArtifact(),
      finalUrl: 'https://shop.example.com/order/confirmed',
      steps: [
        {
          index: 0,
          text: 'Clicking the add-to-cart button.',
          stopReason: 'tool_use',
          durationMs: 1200,
          url: 'https://shop.example.com/product/tshirt',
          usage: { inputTokens: 2000, outputTokens: 80, costUsd: 0.012 },
          actions: [
            {
              type: 'left_click',
              raw: { action: 'left_click', coordinate: [120, 240] },
              outcome: 'ok',
              screenshotPath: '/runs/run-1/step-0.png',
            },
          ],
        },
      ],
      network: [
        { url: 'https://shop.example.com/api/orders', method: 'POST', status: 201, atMs: 4200 },
      ],
    });
    expect(artifact.steps).toHaveLength(1);
    expect(artifact.steps[0]?.actions[0]?.type).toBe('left_click');
    expect(artifact.network[0]?.status).toBe(201);
  });

  it('rejects an unknown status', () => {
    const result = runArtifactSchema.safeParse({ ...baseArtifact(), status: 'flaky' });
    expect(result.success).toBe(false);
  });

  it('rejects a future schema version', () => {
    const result = runArtifactSchema.safeParse({ ...baseArtifact(), artifactSchemaVersion: '9.9' });
    expect(result.success).toBe(false);
  });

  it('rejects negative token counts', () => {
    const result = runArtifactSchema.safeParse({
      ...baseArtifact(),
      usage: { inputTokens: -1, outputTokens: 0, costUsd: 0 },
    });
    expect(result.success).toBe(false);
  });
});
