import type { RunArtifact } from '@taskproof/core';
import { describe, expect, it } from 'vitest';

import { buildReportHtml, parseRunManifest, type RunManifest } from '../src/index.js';

const manifest: RunManifest = {
  manifestVersion: '0.1',
  generatedAtMs: 1_700_000_000_000,
  totalCostUsd: 0.22,
  cells: [
    {
      taskId: 'pricing-trial',
      goal: 'Start a free trial',
      model: 'claude-opus-4-8',
      passK: { k: 1, passes: 1, required: 1, passed: true },
      costUsd: 0.12,
      statuses: ['completed'],
      runIds: ['pricing-trial__opus__0'],
    },
    {
      taskId: 'pricing-trial',
      goal: 'Start a free trial',
      model: 'claude-sonnet-4-6',
      passK: { k: 1, passes: 0, required: 1, passed: false },
      costUsd: 0.1,
      statuses: ['completed'],
      runIds: ['pricing-trial__sonnet__0'],
    },
  ],
};

function artifact(runId: string, model: string, ok: boolean): RunArtifact {
  return {
    artifactSchemaVersion: '0.1',
    runId,
    taskId: 'pricing-trial',
    adapter: 'claude',
    model,
    status: 'completed',
    startedAtMs: 0,
    finishedAtMs: 1000,
    finalUrl: 'https://example.com/trial',
    steps: [
      {
        index: 0,
        text: 'Clicking the trial button.',
        actions: [{ type: 'left_click', raw: {}, outcome: 'ok', screenshotPath: '/runs/x/s0.png' }],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.01,
        },
      },
    ],
    network: [],
    assertions: [
      { type: 'url', ok, detail: ok ? 'matched **/trial**' : 'did not match **/trial**' },
    ],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.12,
    },
  };
}

describe('buildReportHtml', () => {
  const artifacts = [
    artifact('pricing-trial__opus__0', 'claude-opus-4-8', true),
    artifact('pricing-trial__sonnet__0', 'claude-sonnet-4-6', false),
  ];

  it('renders a complete HTML document', () => {
    const html = buildReportHtml({ manifest, artifacts });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>taskproof report</title>');
    expect(html).toContain('1/2 cells passed');
  });

  it('renders the matrix with both models and pass/fail marks', () => {
    const html = buildReportHtml({ manifest, artifacts });
    expect(html).toContain('claude-opus-4-8');
    expect(html).toContain('claude-sonnet-4-6');
    expect(html).toContain('✓ 1/1');
    expect(html).toContain('✗ 0/1');
  });

  it('renders per-run traces with the goal, assertions, and step text', () => {
    const html = buildReportHtml({ manifest, artifacts });
    expect(html).toContain('id="run-pricing-trial__opus__0"');
    expect(html).toContain('Clicking the trial button.');
    expect(html).toContain('matched **/trial**');
    expect(html).toContain('did not match **/trial**');
  });

  it('embeds a screenshot when the resolver provides a data URI', () => {
    const html = buildReportHtml({
      manifest,
      artifacts,
      resolveScreenshot: (path) =>
        path === '/runs/x/s0.png' ? 'data:image/png;base64,AAAA' : undefined,
    });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('shows a fallback when a screenshot cannot be resolved', () => {
    const html = buildReportHtml({ manifest, artifacts });
    expect(html).toContain('unavailable]');
  });

  it('escapes HTML in user-controlled text', () => {
    const evil = artifact('pricing-trial__opus__0', 'claude-opus-4-8', true);
    evil.steps[0]!.text = '<script>alert(1)</script>';
    const html = buildReportHtml({ manifest, artifacts: [evil, artifacts[1]!] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('parseRunManifest', () => {
  it('round-trips a valid manifest', () => {
    expect(parseRunManifest(manifest).cells).toHaveLength(2);
  });

  it('rejects a wrong version', () => {
    expect(() => parseRunManifest({ ...manifest, manifestVersion: '9' })).toThrow();
  });
});
