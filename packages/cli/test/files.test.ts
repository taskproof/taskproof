import { describe, expect, it } from 'vitest';

import { resolveSpecFiles } from '../src/files.js';

describe('resolveSpecFiles', () => {
  it('returns the args when the files exist', async () => {
    // package.json exists in the cli package (vitest cwd), so this resolves.
    await expect(resolveSpecFiles(['package.json'])).resolves.toEqual(['package.json']);
  });

  it('explains an unexpanded glob that matched nothing (not an opaque ENOENT)', async () => {
    await expect(resolveSpecFiles(['no-such-dir/*.yaml'])).rejects.toThrow(/no spec files matched/);
  });

  it('reports a plain missing file by name', async () => {
    await expect(resolveSpecFiles(['definitely-missing.yaml'])).rejects.toThrow(/not found/);
  });

  it('rejects empty input', async () => {
    await expect(resolveSpecFiles([])).rejects.toThrow(/no spec files given/);
  });
});
