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

  it('run exposes the cost/runs/timeout knobs', () => {
    const program = buildProgram();
    const run = program.commands.find((c) => c.name() === 'run');
    const longs = run?.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--max-cost', '--runs', '--timeout']));
  });
});

describe('numeric flag validation', () => {
  it('parsePositiveFloat: accepts plain decimals in (0, max]; rejects garbage/sci/hex/over-max', () => {
    expect(parsePositiveFloat('--max-cost', '1.5', 1000)).toBe(1.5);
    expect(parsePositiveFloat('--max-cost', '0.5', 1000)).toBe(0.5);
    expect(parsePositiveFloat('--max-cost', '.5', 1000)).toBe(0.5); // leading-dot accepted
    expect(parsePositiveFloat('--max-cost', '1.0', 1000)).toBe(1); // trailing zero accepted
    expect(parsePositiveFloat('--max-cost', '1000', 1000)).toBe(1000); // exactly max is allowed
    // '1.' (trailing dot, no fractional digit) is deliberately rejected; pin it so an
    // alternation tweak can't silently start accepting it.
    for (const bad of ['garbage', '1.5abc', '1e6', '0x10', '+5', '1.', '', '0', '-2', '1001']) {
      expect(() => parsePositiveFloat('--max-cost', bad, 1000)).toThrow(/--max-cost/);
    }
  });

  it('parsePositiveInt: accepts integers in 1..max; rejects NaN/Infinity/fractional/over-max', () => {
    expect(parsePositiveInt('-k', '3', 25)).toBe(3);
    expect(parsePositiveInt('-k', '25', 25)).toBe(25);
    for (const bad of ['NaN', 'Infinity', '3.9', '0', '-1', '26', '1e2', '']) {
      expect(() => parsePositiveInt('-k', bad, 25)).toThrow(/-k/);
    }
  });
});
