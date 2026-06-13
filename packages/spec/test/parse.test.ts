import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  TaskSpecValidationError,
  TaskSpecYamlError,
  UnsupportedSpecVersionError,
  parseTaskSpec,
  safeParseTaskSpec,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFile(join(here, 'fixtures', name), 'utf8');

describe('parseTaskSpec', () => {
  it('parses a minimal valid spec', async () => {
    const spec = parseTaskSpec(await fixture('valid-minimal.yaml'));
    expect(spec.id).toBe('minimal');
    expect(spec.allowedDomains).toEqual(['example.com']);
    expect(spec.passPolicy).toEqual({ k: 1, minPasses: 1 });
  });

  it('parses a spec using every field', async () => {
    const spec = parseTaskSpec(await fixture('valid-full.yaml'));
    expect(spec.id).toBe('full-example');
    expect(spec.maxCostUsd).toBe(2.5);
    expect(spec.assertions).toHaveLength(3);
  });

  it('throws TaskSpecYamlError on malformed YAML, prefixed with the filename', async () => {
    const source = await fixture('invalid-yaml.yaml');
    expect(() => parseTaskSpec(source, { filename: 'tasks/broken.yaml' })).toThrowError(
      TaskSpecYamlError,
    );
    try {
      parseTaskSpec(source, { filename: 'tasks/broken.yaml' });
    } catch (error) {
      expect((error as Error).message).toMatch(/^tasks\/broken\.yaml: /);
    }
  });

  it('throws UnsupportedSpecVersionError when specVersion is missing', () => {
    const result = safeParseTaskSpec('id: x\ngoal: y\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(UnsupportedSpecVersionError);
    expect(result.error.message).toContain('specVersion');
    expect(result.error.message).toContain('0.1');
  });

  it('throws UnsupportedSpecVersionError on a future version', () => {
    const result = safeParseTaskSpec('specVersion: "9.9"\nid: x\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(UnsupportedSpecVersionError);
    expect((result.error as UnsupportedSpecVersionError).version).toBe('9.9');
  });

  it('rejects an unquoted numeric specVersion with a quoting hint', async () => {
    const source = (await fixture('valid-minimal.yaml')).replace(
      'specVersion: "0.1"',
      'specVersion: 0.1',
    );
    const result = safeParseTaskSpec(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TaskSpecValidationError);
    expect(result.error.message).toContain('quote it');
    expect(result.error.message).toContain('specVersion: "0.1"');
  });

  it('reports a present-but-non-string specVersion as a type error, not missing', () => {
    const result = safeParseTaskSpec('specVersion: true\nid: x\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TaskSpecValidationError);
    expect(result.error.message).toContain('specVersion must be a string (got boolean)');
  });

  it('does not crash on prototype-key specVersions', () => {
    for (const version of ['toString', 'constructor', 'hasOwnProperty']) {
      const result = safeParseTaskSpec(`specVersion: ${version}\nid: x\n`);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBeInstanceOf(UnsupportedSpecVersionError);
      expect((result.error as UnsupportedSpecVersionError).version).toBe(version);
    }
  });

  it('rejects a top-level __proto__ key', async () => {
    const source = `${await fixture('valid-minimal.yaml')}__proto__:\n  polluted: true\n`;
    const result = safeParseTaskSpec(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('__proto__');
  });

  it('rejects documents that are not mappings', () => {
    for (const source of ['just a string', '- a\n- list', '']) {
      const result = safeParseTaskSpec(source);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBeInstanceOf(TaskSpecValidationError);
    }
  });

  it('reports schema issues with readable paths', async () => {
    const result = safeParseTaskSpec(await fixture('invalid-schema.yaml'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(TaskSpecValidationError);
    const issues = (result.error as TaskSpecValidationError).issues;
    const paths = issues.map((issue) => issue.path);
    expect(paths).toContain('id');
    expect(paths).toContain('goal');
    expect(paths).toContain('entryUrl');
    expect(paths).toContain('maxSteps');
    expect(paths).toContain('passPolicy.minPasses');
  });

  it('formats array paths with brackets', () => {
    const result = safeParseTaskSpec(
      [
        'specVersion: "0.1"',
        'id: x',
        'goal: y',
        'entryUrl: "https://example.com"',
        'assertions:',
        '  - type: dom',
        '    selector: ""',
        '    state: text',
      ].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = (result.error as TaskSpecValidationError).issues.map((issue) => issue.path);
    expect(paths).toContain('assertions[0].selector');
    expect(paths).toContain('assertions[0].text');
  });
});

describe('shipped examples', () => {
  it('every example spec parses cleanly', async () => {
    const examplesDir = join(here, '..', 'examples');
    const files = (await readdir(examplesDir)).filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const source = await readFile(join(examplesDir, name), 'utf8');
      expect(() => parseTaskSpec(source, { filename: name })).not.toThrow();
    }
  });
});
