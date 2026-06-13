/**
 * Claude computer-use runner adapter — placeholder, not yet implemented.
 *
 * Contract for every adapter (the uniformity is the product): run inside
 * Playwright-managed Chromium with CDP tracing and emit the identical artifact
 * schema — screenshots, a11y-tree snapshots, action log, network log,
 * token/cost meter — regardless of which agent vendor is driving.
 */
export const ADAPTER_NAME = 'claude';

export function createClaudeAdapter(): never {
  throw new Error('@gauntlet/adapter-claude is not implemented yet (early scaffold).');
}
