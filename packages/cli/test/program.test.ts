import { describe, expect, it } from 'vitest';

import { buildProgram } from '../src/program.js';

describe('buildProgram', () => {
  it('registers the Sprint 0 command surface', () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toEqual(['baseline', 'init', 'report', 'run', 'validate']);
    expect(program.name()).toBe('taskproof');
  });
});
