/**
 * Resolve the computer-use tool version and beta header for a given model. The two
 * generations differ in their action set and supported models (verified 2026-06).
 */

const COMPUTER_20251124_MODELS = new Set([
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5',
]);

const COMPUTER_20250124_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-0',
  'claude-opus-4-0',
]);

export interface ComputerToolSpec {
  toolType: 'computer_20251124' | 'computer_20250124';
  betaHeader: 'computer-use-2025-11-24' | 'computer-use-2025-01-24';
  /** Whether this generation supports the `zoom` action. */
  supportsZoom: boolean;
}

/**
 * Pick the computer-use tool generation for a model. Unknown models default to the
 * latest (`computer_20251124`) with a flag so the caller can warn — better to attempt
 * the run than to hard-fail on a model the table simply hasn't been updated for.
 */
export function resolveComputerTool(model: string): ComputerToolSpec & { known: boolean } {
  if (COMPUTER_20251124_MODELS.has(model)) {
    return {
      toolType: 'computer_20251124',
      betaHeader: 'computer-use-2025-11-24',
      supportsZoom: true,
      known: true,
    };
  }
  if (COMPUTER_20250124_MODELS.has(model)) {
    return {
      toolType: 'computer_20250124',
      betaHeader: 'computer-use-2025-01-24',
      supportsZoom: false,
      known: true,
    };
  }
  return {
    toolType: 'computer_20251124',
    betaHeader: 'computer-use-2025-11-24',
    supportsZoom: true,
    known: false,
  };
}

/** Default virtual display. ≤1568px long edge and ≤1.15MP keeps coordinates 1:1 on every model. */
export const DEFAULT_DISPLAY = { widthPx: 1280, heightPx: 800 } as const;
