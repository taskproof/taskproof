import { describe, expect, it } from 'vitest';

import { buildProgram, parsePositiveFloat, parsePositiveInt } from '../src/program.js';

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

describe('numeric flag validation', () => {
  it('parsePositiveFloat rejects NaN / non-positive / trailing-garbage, accepts a positive number', () => {
    expect(parsePositiveFloat('--max-cost', '1.5')).toBe(1.5);
    expect(() => parsePositiveFloat('--max-cost', 'garbage')).toThrow(/positive number/);
    expect(() => parsePositiveFloat('--max-cost', '1.5abc')).toThrow(/positive number/);
    expect(() => parsePositiveFloat('--max-cost', '')).toThrow(/positive number/);
    expect(() => parsePositiveFloat('--max-cost', '0')).toThrow(/positive number/);
    expect(() => parsePositiveFloat('--max-cost', '-2')).toThrow(/positive number/);
  });

  it('parsePositiveInt rejects NaN / non-positive / fractional, accepts a positive integer', () => {
    expect(parsePositiveInt('-k', '3')).toBe(3);
    expect(() => parsePositiveInt('-k', 'NaN')).toThrow(/positive integer/);
    expect(() => parsePositiveInt('-k', '3.9')).toThrow(/positive integer/);
    expect(() => parsePositiveInt('-k', '0')).toThrow(/positive integer/);
    expect(() => parsePositiveInt('-k', '-1')).toThrow(/positive integer/);
  });
});
