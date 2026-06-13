import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as clack from '@clack/prompts';

export interface DetectedFramework {
  name: string;
  /** A sensible default local dev URL for the framework. */
  defaultUrl: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// First match wins; order more specific deps before the generic bundler they build on.
const FRAMEWORKS: ReadonlyArray<{ dep: string; name: string; port: number }> = [
  { dep: 'next', name: 'Next.js', port: 3000 },
  { dep: 'nuxt', name: 'Nuxt', port: 3000 },
  { dep: '@remix-run/react', name: 'Remix', port: 3000 },
  { dep: 'gatsby', name: 'Gatsby', port: 8000 },
  { dep: 'astro', name: 'Astro', port: 4321 },
  { dep: '@sveltejs/kit', name: 'SvelteKit', port: 5173 },
  { dep: 'react-scripts', name: 'Create React App', port: 3000 },
  { dep: '@angular/core', name: 'Angular', port: 4200 },
  { dep: 'vite', name: 'Vite', port: 5173 },
];

/** Infer the project's framework (and a default dev URL) from its package.json. */
export function detectFramework(pkg: PackageJson | null): DetectedFramework {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  for (const framework of FRAMEWORKS) {
    if (framework.dep in deps) {
      return { name: framework.name, defaultUrl: `http://localhost:${framework.port}` };
    }
  }
  return { name: 'unknown', defaultUrl: 'http://localhost:3000' };
}

export interface StarterSpec {
  filename: string;
  content: string;
}

/** Three starter task specs, parameterized to the site's base URL, for the user to edit. */
export function starterSpecs(baseUrl: string): StarterSpec[] {
  const url = baseUrl.replace(/\/+$/, '');
  return [
    {
      filename: 'homepage-cta.yaml',
      content: `# Can an agent find and act on your homepage's primary call-to-action?
specVersion: "0.1"
id: homepage-cta
goal: "From the homepage, find the primary call-to-action (e.g. Sign up, Get started, Start free trial) and click it."
entryUrl: "${url}"
maxSteps: 15
maxCostUsd: 1.00
passPolicy:
  k: 3
  minPasses: 2
assertions:
  # EDIT ME: the URL (or element) that a successful click should reach.
  - type: url
    pattern: "**/signup**"
`,
    },
    {
      filename: 'pricing-trial.yaml',
      content: `# The canonical SaaS journey: find pricing, start a trial.
specVersion: "0.1"
id: pricing-trial
goal: "Find the pricing page, identify the plans, and start a free trial of any paid plan."
entryUrl: "${url}"
maxSteps: 25
maxCostUsd: 2.00
passPolicy:
  k: 3
  minPasses: 2
assertions:
  # EDIT ME: your trial/signup confirmation URL.
  - type: url
    pattern: "**/trial**"
`,
    },
    {
      filename: 'docs-quickstart.yaml',
      content: `# Docs-as-target: can an agent find your getting-started instructions?
specVersion: "0.1"
id: docs-quickstart
goal: "Find the documentation or getting-started guide and locate the command or first step needed to begin."
entryUrl: "${url}"
tags: [docs]
maxSteps: 15
maxCostUsd: 1.00
assertions:
  # EDIT ME: an element that proves the quickstart was found.
  - type: dom
    selector: "pre"
    state: visible
`,
    },
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

/** Write the starter specs into `dir`, skipping existing files unless `force`. */
export async function scaffold(
  dir: string,
  specs: StarterSpec[],
  force: boolean,
): Promise<ScaffoldResult> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const spec of specs) {
    const path = join(dir, spec.filename);
    if (!force && (await fileExists(path))) {
      skipped.push(path);
      continue;
    }
    await writeFile(path, spec.content);
    written.push(path);
  }
  return { written, skipped };
}

async function readPackageJson(cwd: string): Promise<PackageJson | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    return raw as PackageJson;
  } catch {
    return null;
  }
}

export interface InitOptions {
  url?: string;
  dir: string;
  force?: boolean;
  /** Skip prompts; use the detected/default URL. */
  yes?: boolean;
}

/** Interactive scaffolder behind `taskproof init`. */
export async function runInit(options: InitOptions): Promise<void> {
  clack.intro('taskproof init');

  const framework = detectFramework(await readPackageJson(process.cwd()));
  if (framework.name !== 'unknown') clack.log.info(`Detected ${framework.name}.`);

  let url = options.url;
  if (url === undefined) {
    if (options.yes !== true && process.stdin.isTTY === true) {
      const answer = await clack.text({
        message: 'Base URL of the site to test',
        initialValue: framework.defaultUrl,
        validate: (value) => (isHttpUrl(value) ? undefined : 'enter a valid http(s) URL'),
      });
      if (clack.isCancel(answer)) {
        clack.cancel('init cancelled');
        process.exitCode = 1;
        return;
      }
      url = answer;
    } else {
      url = framework.defaultUrl;
    }
  }

  if (!isHttpUrl(url)) {
    clack.log.error(`invalid URL: ${url}`);
    process.exitCode = 1;
    return;
  }

  const result = await scaffold(options.dir, starterSpecs(url), options.force === true);
  for (const path of result.written) clack.log.success(`wrote ${path}`);
  for (const path of result.skipped) {
    clack.log.warn(`exists, skipped ${path} (use --force to overwrite)`);
  }

  if (result.written.length === 0 && result.skipped.length > 0) {
    clack.outro('Nothing written — specs already exist. Re-run with --force to overwrite.');
    return;
  }

  clack.outro(
    `Scaffolded ${result.written.length} spec(s) in ${options.dir}.\n` +
      `Next: edit them, then run\n` +
      `  npx taskproof run ${options.dir}/*.yaml --models claude-opus-4-8\n` +
      `  npx taskproof report`,
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
