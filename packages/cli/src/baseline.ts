import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { diffManifests, parseRunManifest, type ManifestDiff } from '@taskproof/report';

import { MANIFEST_FILENAME } from './run.js';

async function readManifest(path: string) {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  return parseRunManifest(raw);
}

/** Snapshot the latest run's manifest as a baseline to diff future runs against. */
export async function saveBaseline(
  dir: string,
  to: string,
): Promise<{ cells: number; to: string }> {
  const manifest = await readManifest(join(dir, MANIFEST_FILENAME));
  await writeFile(to, JSON.stringify(manifest, null, 2));
  return { cells: manifest.cells.length, to };
}

/** Diff the current run (in `dir`) against a saved baseline file. */
export async function diffAgainstBaseline(
  dir: string,
  baselinePath: string,
): Promise<ManifestDiff> {
  const [baseline, current] = await Promise.all([
    readManifest(baselinePath),
    readManifest(join(dir, MANIFEST_FILENAME)),
  ]);
  return diffManifests(baseline, current);
}
