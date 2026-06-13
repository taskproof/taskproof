import { describe, expect, it } from 'vitest';

import { buildProgram } from '../src/program.js';

describe('buildProgram', () => {
  it('registers the command surface', () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toEqual(['baseline', 'diff', 'init', 'report', 'run', 'validate']);
    expect(program.name()).toBe('taskproof');
  });

  it('baseline has a save subcommand', () => {
    const program = buildProgram();
    const baseline = program.commands.find((c) => c.name() === 'baseline');
    expect(baseline?.commands.map((c) => c.name())).toEqual(['save']);
  });
});
