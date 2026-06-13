import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseRunArtifact, type RunArtifact } from '@taskproof/core';
import { buildReportHtml, parseRunManifest } from '@taskproof/report';

import { MANIFEST_FILENAME } from './run.js';

export interface GenerateReportResult {
  outFile: string;
  cells: number;
  runs: number;
}

/** Read a run directory's manifest + artifacts and write a self-contained HTML report. */
export async function generateReport(dir: string, outFile: string): Promise<GenerateReportResult> {
  const manifestRaw: unknown = JSON.parse(await readFile(join(dir, MANIFEST_FILENAME), 'utf8'));
  const manifest = parseRunManifest(manifestRaw);

  const artifacts: RunArtifact[] = [];
  for (const runId of manifest.cells.flatMap((cell) => cell.runIds)) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, `${runId}.json`), 'utf8'));
      artifacts.push(parseRunArtifact(raw));
    } catch {
      // A missing or unreadable artifact just renders without its trace.
    }
  }

  const screenshotCache = new Map<string, string | undefined>();
  const resolveScreenshot = (path: string): string | undefined => {
    if (screenshotCache.has(path)) return screenshotCache.get(path);
    let uri: string | undefined;
    try {
      uri = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    } catch {
      uri = undefined;
    }
    screenshotCache.set(path, uri);
    return uri;
  };

  const html = buildReportHtml({
    manifest,
    artifacts,
    resolveScreenshot,
    title: `taskproof report — ${dir}`,
  });
  await writeFile(outFile, html);
  return { outFile, cells: manifest.cells.length, runs: artifacts.length };
}
