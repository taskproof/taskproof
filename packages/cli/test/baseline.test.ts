import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MANIFEST_FILENAME } from '../src/run.js';
import { diffAgainstBaseline, saveBaseline } from '../src/baseline.js';

function manifest(passes: number) {
  return {
    manifestVersion: '0.1',
    generatedAtMs: 0,
    totalCostUsd: 0.5,
    cells: [
      {
        taskId: 'checkout',
        goal: 'buy a thing',
        model: 'claude-opus-4-8',
        passK: { k: 5, passes, required: 3, passed: passes >= 3 },
        costUsd: 0.5,
        statuses: [],
        runIds: [],
      },
    ],
  };
}

describe('baseline save + diff', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskproof-baseline-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves the latest manifest as a baseline and diffs a later run against it', async () => {
    // A passing baseline run.
    await writeFile(join(dir, MANIFEST_FILENAME), JSON.stringify(manifest(5)), 'utf8');
    const baselineFile = join(dir, 'baseline.json');
    const saved = await saveBaseline(dir, baselineFile);
    expect(saved.cells).toBe(1);

    // A later, regressed run in the same dir.
    await writeFile(join(dir, MANIFEST_FILENAME), JSON.stringify(manifest(1)), 'utf8');
    const diff = await diffAgainstBaseline(dir, baselineFile);
    expect(diff.hasRegression).toBe(true);
    expect(diff.changes[0]?.kind).toBe('regressed');
    expect(diff.changes[0]?.passesBefore).toBe(5);
    expect(diff.changes[0]?.passesAfter).toBe(1);
  });
});
