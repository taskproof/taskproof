import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatFileResult, validateFiles } from '../src/validate.js';

const VALID = `specVersion: "0.1"
id: smoke
goal: "Reach the pricing page"
entryUrl: "https://example.com"
assertions:
  - type: url
    pattern: "**/pricing**"
`;

const INVALID = `specVersion: "0.1"
id: smoke
goal: ""
entryUrl: "https://example.com"
assertions: []
`;

describe('validateFiles', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskproof-validate-'));
    await writeFile(join(dir, 'valid.yaml'), VALID, 'utf8');
    await writeFile(join(dir, 'invalid.yaml'), INVALID, 'utf8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports valid and invalid files with structured errors', async () => {
    const results = await validateFiles([join(dir, 'valid.yaml'), join(dir, 'invalid.yaml')]);

    expect(results[0]).toMatchObject({ ok: true, id: 'smoke' });
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.errors.some((line) => line.startsWith('goal'))).toBe(true);
    expect(results[1]?.errors.some((line) => line.startsWith('assertions'))).toBe(true);
  });

  it('reports unreadable files instead of throwing', async () => {
    const results = await validateFiles([join(dir, 'missing.yaml')]);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.errors[0]).toContain('cannot read file');
  });

  it('formats results for the terminal', async () => {
    const results = await validateFiles([join(dir, 'valid.yaml')]);
    const result = results[0];
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(formatFileResult(result)).toContain('✓');
    expect(formatFileResult(result)).toContain('(smoke)');
  });
});
