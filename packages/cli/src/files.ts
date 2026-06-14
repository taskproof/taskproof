import { access } from 'node:fs/promises';

// Shell metacharacters: if an arg containing these reaches us, the shell didn't expand it.
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Resolve spec-file arguments, failing with a clear message instead of an opaque ENOENT.
 *
 * Shells expand globs before taskproof sees them, so a pattern like `tasks/*.yaml` that
 * arrives literally means it matched nothing (or the shell didn't expand it — e.g. it was
 * quoted). Without this, `run` would die on `ENOENT … open 'tasks/*.yaml'`.
 */
export async function resolveSpecFiles(args: string[]): Promise<string[]> {
  if (args.length === 0) throw new Error('no spec files given');
  const unmatchedGlobs: string[] = [];
  const missing: string[] = [];
  for (const arg of args) {
    try {
      await access(arg);
    } catch {
      (GLOB_CHARS.test(arg) ? unmatchedGlobs : missing).push(arg);
    }
  }
  if (unmatchedGlobs.length > 0) {
    throw new Error(
      `no spec files matched ${unmatchedGlobs.map((g) => `"${g}"`).join(', ')} — the pattern ` +
        `reached taskproof unexpanded (nothing matched it, or your shell didn't expand it). ` +
        `Check the path, e.g. \`taskproof run taskproof/tasks/*.yaml\` from your repo root.`,
    );
  }
  if (missing.length > 0) {
    throw new Error(`spec file(s) not found: ${missing.join(', ')}`);
  }
  return args;
}
