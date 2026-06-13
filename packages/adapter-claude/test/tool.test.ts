import { describe, expect, it } from 'vitest';

import { resolveComputerTool, supportsEffort } from '../src/tool.js';

describe('resolveComputerTool', () => {
  it('picks the 20251124 tool + beta for current models', () => {
    const tool = resolveComputerTool('claude-opus-4-8');
    expect(tool).toMatchObject({
      toolType: 'computer_20251124',
      betaHeader: 'computer-use-2025-11-24',
      supportsZoom: true,
      known: true,
    });
  });

  it('picks the 20250124 tool + beta for older models', () => {
    const tool = resolveComputerTool('claude-haiku-4-5');
    expect(tool).toMatchObject({
      toolType: 'computer_20250124',
      betaHeader: 'computer-use-2025-01-24',
      supportsZoom: false,
      known: true,
    });
  });

  it('defaults unknown models to the latest tool and flags them', () => {
    const tool = resolveComputerTool('claude-future-9');
    expect(tool.toolType).toBe('computer_20251124');
    expect(tool.known).toBe(false);
  });
});

describe('supportsEffort', () => {
  it('is true for Opus 4.5+ and Sonnet 4.6', () => {
    expect(supportsEffort('claude-opus-4-8')).toBe(true);
    expect(supportsEffort('claude-sonnet-4-6')).toBe(true);
  });

  it('is false for Haiku 4.5 (effort 400s there)', () => {
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
  });
});
