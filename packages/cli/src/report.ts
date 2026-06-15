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

/**
 * Detect an image's MIME type from its magic bytes, defaulting to PNG (what the adapters capture
 * today). Inlining a JPEG/WebP as `data:image/png` is wrong — browsers sniff and usually cope,
 * but a correct type lets a report use far smaller screenshot formats (a hostable report).
 */
export function detectImageMime(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    (bytes.toString('ascii', 0, 6) === 'GIF89a' || bytes.toString('ascii', 0, 6) === 'GIF87a')
  ) {
    return 'image/gif';
  }
  return 'image/png';
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
      const bytes = readFileSync(path);
      uri = `data:${detectImageMime(bytes)};base64,${bytes.toString('base64')}`;
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
