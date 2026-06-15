import { stat } from 'node:fs/promises';

// Shell metacharacters: if an arg containing these reaches us, the shell didn't expand it.
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Resolve spec-file arguments, failing with a clear message instead of an opaque ENOENT/EISDIR.
 *
 * Shells expand globs before taskproof sees them, so a pattern like `tasks/*.yaml` that
 * arrives literally means it matched nothing (or the shell didn't expand it — e.g. it was
 * quoted). Without this, `run` would die on `ENOENT … open 'tasks/*.yaml'`. A directory arg
 * (`taskproof run tasks/`) is rejected too — it `access()`es fine but later dies on a `readFile`
 * EISDIR, the exact opaque failure this function exists to prevent.
 */
export async function resolveSpecFiles(args: string[]): Promise<string[]> {
  if (args.length === 0) throw new Error('no spec files given');
  const unmatchedGlobs: string[] = [];
  const missing: string[] = [];
  const directories: string[] = [];
  for (const arg of args) {
    try {
      const stats = await stat(arg);
      if (stats.isDirectory()) directories.push(arg);
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
  if (directories.length > 0) {
    const [first] = directories;
    throw new Error(
      `expected spec file(s), but ${directories.map((d) => `"${d}"`).join(', ')} ` +
        `${directories.length === 1 ? 'is a directory' : 'are directories'} — pass the YAML ` +
        `files, e.g. \`taskproof run ${first}/*.yaml\`, not the directory itself.`,
    );
  }
  return args;
}
