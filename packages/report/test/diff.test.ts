import { describe, expect, it } from 'vitest';

import {
  DIFF_COMMENT_MARKER,
  diffManifests,
  formatDiff,
  formatDiffMarkdown,
  type RunManifest,
} from '../src/index.js';

function cell(taskId: string, model: string, passes: number, k: number, costUsd = 0.1) {
  return {
    taskId,
    goal: 'g',
    model,
    passK: { k, passes, required: Math.ceil(k / 2), passed: passes >= Math.ceil(k / 2) },
    costUsd,
    statuses: [],
    runIds: [],
  };
}

function manifest(cells: ReturnType<typeof cell>[], totalCostUsd = 0): RunManifest {
  return { manifestVersion: '0.1', generatedAtMs: 0, totalCostUsd, cells };
}

describe('diffManifests', () => {
  it('flags a pass→fail cell as a regression and gates on it', () => {
    const before = manifest([cell('checkout', 'claude-opus-4-8', 5, 5)]);
    const after = manifest([cell('checkout', 'claude-opus-4-8', 1, 5)]);
    const diff = diffManifests(before, after);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressions).toBe(1);
    expect(diff.changes[0]?.kind).toBe('regressed');
    expect(diff.changes[0]?.passesBefore).toBe(5);
    expect(diff.changes[0]?.passesAfter).toBe(1);
  });

  it('flags a fail→pass cell as a fix, no regression', () => {
    const diff = diffManifests(manifest([cell('t', 'm', 0, 3)]), manifest([cell('t', 'm', 3, 3)]));
    expect(diff.hasRegression).toBe(false);
    expect(diff.fixes).toBe(1);
    expect(diff.changes[0]?.kind).toBe('fixed');
  });

  it('distinguishes improved/worsened within the same pass status', () => {
    const stillPassing = diffManifests(
      manifest([cell('t', 'm', 5, 5)]),
      manifest([cell('t', 'm', 4, 5)]),
    );
    expect(stillPassing.changes[0]?.kind).toBe('worsened');
    expect(stillPassing.hasRegression).toBe(false);
  });

  it('marks added and removed cells', () => {
    const diff = diffManifests(
      manifest([cell('old', 'm', 3, 3)]),
      manifest([cell('new', 'm', 3, 3)]),
    );
    const kinds = diff.changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(['added', 'removed']);
  });

  it('orders regressions first', () => {
    const before = manifest([cell('a', 'm', 3, 3), cell('b', 'm', 0, 3)]);
    const after = manifest([cell('a', 'm', 0, 3), cell('b', 'm', 3, 3)]);
    const diff = diffManifests(before, after);
    expect(diff.changes[0]?.kind).toBe('regressed');
    expect(diff.changes[0]?.taskId).toBe('a');
  });
});

describe('formatDiff / formatDiffMarkdown', () => {
  const diff = diffManifests(
    manifest([cell('checkout', 'claude-opus-4-8', 5, 5)], 0.5),
    manifest([cell('checkout', 'claude-opus-4-8', 1, 5)], 0.5),
  );

  it('text output shows the transition and a summary', () => {
    const out = formatDiff(diff);
    expect(out).toContain('REGRESSED');
    expect(out).toContain('5/5 → 1/5');
    expect(out).toContain('1 regression(s)');
  });

  it('markdown headlines regressions and renders a table', () => {
    const md = formatDiffMarkdown(diff);
    expect(md).toContain('⚠️ taskproof: 1 agent-usability regression');
    expect(md).toContain('| `checkout` | `claude-opus-4-8` | 5/5 → 1/5 |');
  });

  it('markdown leads with the sticky-comment marker (for find-and-update in CI)', () => {
    const md = formatDiffMarkdown(diff);
    expect(md.startsWith(DIFF_COMMENT_MARKER)).toBe(true);
  });

  it('markdown reports the run cost delta', () => {
    expect(formatDiffMarkdown(diff)).toContain('Run cost: $0.5000 → $0.5000.');
  });

  it('markdown reports a clean run with no regressions (marker + cost, no table)', () => {
    const clean = diffManifests(manifest([cell('t', 'm', 3, 3)]), manifest([cell('t', 'm', 3, 3)]));
    const md = formatDiffMarkdown(clean);
    expect(md).toContain('no agent-usability changes');
    expect(md.startsWith(DIFF_COMMENT_MARKER)).toBe(true);
    expect(md).toContain('Run cost:');
    expect(md).not.toContain('| Change |');
  });
});
