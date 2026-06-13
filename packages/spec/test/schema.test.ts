import { describe, expect, it } from 'vitest';

import { SPEC_VERSION, taskSpecSchema, type TaskSpecInput } from '../src/index.js';

const minimal: TaskSpecInput = {
  specVersion: '0.1',
  id: 'minimal',
  goal: 'Reach the pricing page',
  entryUrl: 'https://example.com/start',
  assertions: [{ type: 'url', pattern: '**/pricing**' }],
};

function parse(overrides: Record<string, unknown> = {}) {
  return taskSpecSchema.safeParse({ ...minimal, ...overrides });
}

describe('taskSpecSchema', () => {
  it('accepts a minimal spec and applies defaults', () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.maxSteps).toBe(20);
    expect(result.data.passPolicy).toEqual({ k: 1, minPasses: 1 });
    expect(result.data.assertions[0]).toEqual({ type: 'url', pattern: '**/pricing**' });
  });

  it('derives allowedDomains from the entryUrl hostname when omitted', () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.allowedDomains).toEqual(['example.com']);
  });

  it('keeps explicit allowedDomains, including wildcards and localhost', () => {
    const result = parse({
      allowedDomains: ['shop.example.com', '*.payments.example.com', 'localhost'],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.allowedDomains).toEqual([
      'shop.example.com',
      '*.payments.example.com',
      'localhost',
    ]);
  });

  it('rejects malformed domains', () => {
    expect(parse({ allowedDomains: ['not a domain!'] }).success).toBe(false);
    expect(parse({ allowedDomains: ['https://example.com'] }).success).toBe(false);
  });

  it('rejects non-http(s) entry URLs', () => {
    expect(parse({ entryUrl: 'ftp://example.com' }).success).toBe(false);
    expect(parse({ entryUrl: 'not-a-url' }).success).toBe(false);
  });

  it('rejects entry URLs with embedded credentials', () => {
    expect(parse({ entryUrl: 'https://user:secret@example.com' }).success).toBe(false);
    expect(parse({ entryUrl: 'https://token@example.com' }).success).toBe(false);
  });

  it('rejects an explicitly empty allowedDomains list', () => {
    expect(parse({ allowedDomains: [] }).success).toBe(false);
  });

  it('flags entry URLs whose host cannot become an allowed domain', () => {
    expect(parse({ entryUrl: 'https://[::1]:3000/start' }).success).toBe(false);
  });

  it('rejects non-finite numbers with a finite-number message', () => {
    const result = parse({ maxCostUsd: Infinity });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.message.includes('finite'))).toBe(true);
  });

  it('bounds maxCostUsd to a sane per-run cap', () => {
    expect(parse({ maxCostUsd: 1e308 }).success).toBe(false);
    expect(parse({ maxCostUsd: 1001 }).success).toBe(false);
    expect(parse({ maxCostUsd: 2.5 }).success).toBe(true);
  });

  it('rejects ids that are not kebab-case', () => {
    expect(parse({ id: 'Bad_ID' }).success).toBe(false);
    expect(parse({ id: '-leading-hyphen' }).success).toBe(false);
    expect(parse({ id: 'fine-id-2' }).success).toBe(true);
  });

  it('rejects an empty goal and empty assertions', () => {
    expect(parse({ goal: '' }).success).toBe(false);
    expect(parse({ assertions: [] }).success).toBe(false);
  });

  it('rejects unknown top-level keys (typo protection)', () => {
    expect(parse({ asserts: [{ type: 'url', pattern: 'x' }] }).success).toBe(false);
  });

  it('bounds maxSteps', () => {
    expect(parse({ maxSteps: 0 }).success).toBe(false);
    expect(parse({ maxSteps: 201 }).success).toBe(false);
    expect(parse({ maxSteps: 40 }).success).toBe(true);
  });

  it('rejects minPasses greater than k', () => {
    const result = parse({ passPolicy: { k: 3, minPasses: 5 } });
    expect(result.success).toBe(false);
  });

  it('requires text exactly when a dom assertion uses state "text"', () => {
    const missingText = parse({ assertions: [{ type: 'dom', selector: 'h1', state: 'text' }] });
    expect(missingText.success).toBe(false);

    const strayText = parse({
      assertions: [{ type: 'dom', selector: 'h1', state: 'visible', text: 'Welcome' }],
    });
    expect(strayText.success).toBe(false);

    const ok = parse({
      assertions: [{ type: 'dom', selector: 'h1', state: 'text', text: 'Welcome' }],
    });
    expect(ok.success).toBe(true);
  });

  it('accepts network status as a code or a class, rejects nonsense', () => {
    const base = { type: 'network', urlPattern: '**/api/**' };
    expect(parse({ assertions: [{ ...base, status: 200 }] }).success).toBe(true);
    expect(parse({ assertions: [{ ...base, status: '2xx' }] }).success).toBe(true);
    expect(parse({ assertions: [{ ...base, status: '6xx' }] }).success).toBe(false);
    expect(parse({ assertions: [{ ...base, status: 42 }] }).success).toBe(false);
  });

  it('rejects unknown assertion types', () => {
    expect(parse({ assertions: [{ type: 'screenshot', pattern: 'x' }] }).success).toBe(false);
  });

  it('pins the version literal', () => {
    expect(SPEC_VERSION).toBe('0.1');
    expect(parse({ specVersion: '0.2' }).success).toBe(false);
  });
});
