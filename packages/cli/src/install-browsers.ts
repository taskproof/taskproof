import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Resolve the Playwright CLI from the SAME Playwright the Claude adapter pins, so the Chromium
 * we install matches the revision the adapter will drive. Resolving via @taskproof/adapter-claude
 * (which declares the dependency) works under both pnpm and a hoisted npm install; reading the
 * package's own `bin` avoids tripping over Playwright's `exports` map.
 */
function resolvePlaywrightCli(): string | undefined {
  const tryResolve = (fromEntry?: string): string | undefined => {
    try {
      const req = fromEntry ? createRequire(fromEntry) : createRequire(import.meta.url);
      const pkgJsonPath = req.resolve('playwright/package.json');
      const bin = (
        JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: { playwright?: string } }
      ).bin?.playwright;
      if (bin === undefined) return undefined;
      return join(dirname(pkgJsonPath), bin);
    } catch {
      return undefined;
    }
  };
  // Prefer Playwright as seen by the Claude adapter (the version it pins), then fall back to a
  // top-level resolution (hoisted installs).
  let adapterEntry: string | undefined;
  try {
    adapterEntry = createRequire(import.meta.url).resolve('@taskproof/adapter-claude');
  } catch {
    adapterEntry = undefined;
  }
  return tryResolve(adapterEntry) ?? tryResolve();
}

/**
 * `taskproof install-browsers` — install the Chromium the Claude adapter needs, via the bundled
 * Playwright. Turnkey alternative to a customer guessing the right `npx playwright install`
 * version (a real rough edge surfaced by dogfooding the published CLI in CI).
 *
 * `withDeps` forwards Playwright's `--with-deps`, which also installs the OS-level libraries
 * Chromium needs (via the system package manager — needs root). That's what CI wants on a Linux
 * runner; it's off by default because local dev usually has the libs and shouldn't need sudo.
 */
export async function installBrowsers(options: { withDeps?: boolean } = {}): Promise<number> {
  const cli = resolvePlaywrightCli();
  if (cli === undefined) {
    process.stderr.write(
      'Could not locate Playwright (the Claude adapter bundles it). Install taskproof first ' +
        '(e.g. `npm i taskproof`), then re-run `taskproof install-browsers`.\n',
    );
    return 1;
  }
  process.stdout.write('Installing Chromium for the Claude computer-use adapter…\n');
  const args = ['install', ...(options.withDeps === true ? ['--with-deps'] : []), 'chromium'];
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      process.stderr.write(`playwright install failed: ${err.message}\n`);
      resolve(1);
    });
  });
}
