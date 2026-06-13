import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTaskSpec } from '@taskproof/spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { detectFramework, scaffold, starterSpecs } from '../src/init.js';

describe('detectFramework', () => {
  it('detects Next.js and its dev port', () => {
    expect(detectFramework({ dependencies: { next: '15.0.0' } })).toEqual({
      name: 'Next.js',
      defaultUrl: 'http://localhost:3000',
    });
  });

  it('detects Vite from devDependencies', () => {
    expect(detectFramework({ devDependencies: { vite: '5.0.0' } }).defaultUrl).toBe(
      'http://localhost:5173',
    );
  });

  it('prefers SvelteKit over the underlying Vite', () => {
    expect(
      detectFramework({ devDependencies: { vite: '5.0.0', '@sveltejs/kit': '2.0.0' } }).name,
    ).toBe('SvelteKit');
  });

  it('falls back to unknown + 3000 when nothing matches', () => {
    expect(detectFramework(null)).toEqual({ name: 'unknown', defaultUrl: 'http://localhost:3000' });
    expect(detectFramework({ dependencies: { lodash: '4' } }).name).toBe('unknown');
  });
});

describe('starterSpecs', () => {
  it('produces three specs that all validate against the spec schema', () => {
    const specs = starterSpecs('https://example.com/');
    expect(specs).toHaveLength(3);
    for (const spec of specs) {
      const parsed = parseTaskSpec(spec.content);
      expect(parsed.entryUrl).toBe('https://example.com'); // trailing slash trimmed
    }
  });

  it('covers homepage, pricing, and docs journeys', () => {
    const ids = starterSpecs('https://x.com').map((s) => parseTaskSpec(s.content).id);
    expect(ids).toEqual(['homepage-cta', 'pricing-trial', 'docs-quickstart']);
  });
});

describe('scaffold', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskproof-init-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes all specs into a fresh directory', async () => {
    const target = join(dir, 'fresh');
    const result = await scaffold(target, starterSpecs('https://x.com'), false);
    expect(result.written).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    const written = await readFile(join(target, 'homepage-cta.yaml'), 'utf8');
    expect(written).toContain('id: homepage-cta');
  });

  it('skips existing files unless force is set', async () => {
    const target = join(dir, 'existing');
    const specs = starterSpecs('https://x.com');
    await scaffold(target, specs, false);
    await writeFile(join(target, 'homepage-cta.yaml'), 'edited by user', 'utf8');

    const second = await scaffold(target, specs, false);
    expect(second.written).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);
    expect(await readFile(join(target, 'homepage-cta.yaml'), 'utf8')).toBe('edited by user');

    const forced = await scaffold(target, specs, true);
    expect(forced.written).toHaveLength(3);
    expect(await readFile(join(target, 'homepage-cta.yaml'), 'utf8')).toContain('id: homepage-cta');
  });
});
