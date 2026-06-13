import type { PassPolicy } from '@taskproof/spec';

export interface PassKResult {
  k: number;
  passes: number;
  required: number;
  /** Whether the threshold was met: passes >= policy.minPasses. */
  passed: boolean;
}

/**
 * Aggregate per-run pass/fail booleans against a pass@k policy. This is the gate — a
 * statistical threshold over k runs, never a single binary check.
 */
export function aggregatePassK(perRunPassed: readonly boolean[], policy: PassPolicy): PassKResult {
  const passes = perRunPassed.filter(Boolean).length;
  return {
    k: perRunPassed.length,
    passes,
    required: policy.minPasses,
    passed: passes >= policy.minPasses,
  };
}
