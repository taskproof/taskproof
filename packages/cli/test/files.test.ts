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

  it('rejects a directory arg up front (not an opaque EISDIR at readFile time)', async () => {
    // 'src' is a directory in the cli package (vitest cwd); access() succeeds on it, so the
    // guard must stat-and-reject it rather than let runSpecs die later on readFile(dir).
    await expect(resolveSpecFiles(['src'])).rejects.toThrow(/is a directory/);
  });
});
