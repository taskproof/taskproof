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

export interface GenerateReportOptions {
  /**
   * Downscale inlined screenshots to at most this width (px) and re-encode as JPEG, so the
   * self-contained report is small enough to host. Omitted (or ≤ 0) inlines the originals at
   * full resolution (the default — lossless, but reports can run tens of MB).
   */
  maxImageWidth?: number;
  /** JPEG quality (1–100) used only when downscaling. Default 75. */
  imageQuality?: number;
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

/**
 * Turn a screenshot file into a data URI. With `maxWidth > 0`, downscale wider images and
 * re-encode as JPEG (a hostable report); otherwise inline the original bytes. Any read or
 * image-processing failure degrades gracefully — a missing file → `undefined`, a jimp error →
 * the original bytes inlined.
 */
async function screenshotToDataUri(
  path: string,
  maxWidth: number,
  quality: number,
): Promise<string | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return undefined;
  }
  if (maxWidth > 0) {
    try {
      // Lazy import: jimp is only loaded when downscaling is requested.
      const { Jimp } = await import('jimp');
      const image = await Jimp.read(bytes);
      if (image.width > maxWidth) {
        image.resize({ w: maxWidth });
        const jpeg = await image.getBuffer('image/jpeg', { quality });
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      }
    } catch {
      // fall through to inlining the original on any image-processing error
    }
  }
  return `data:${detectImageMime(bytes)};base64,${bytes.toString('base64')}`;
}

/** Read a run directory's manifest + artifacts and write a self-contained HTML report. */
export async function generateReport(
  dir: string,
  outFile: string,
  options: GenerateReportOptions = {},
): Promise<GenerateReportResult> {
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

  const maxWidth = options.maxImageWidth ?? 0;
  const quality = options.imageQuality ?? 75;
  // Pre-resolve every referenced screenshot up front (downscaling is async) so buildReportHtml's
  // synchronous resolve callback just reads from the cache.
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    for (const step of artifact.steps) {
      for (const action of step.actions) {
        if (action.screenshotPath !== undefined) paths.add(action.screenshotPath);
      }
    }
  }
  const cache = new Map<string, string | undefined>();
  for (const path of paths) {
    cache.set(path, await screenshotToDataUri(path, maxWidth, quality));
  }

  const html = buildReportHtml({
    manifest,
    artifacts,
    resolveScreenshot: (path: string): string | undefined => cache.get(path),
    title: `taskproof report — ${dir}`,
  });
  await writeFile(outFile, html);
  return { outFile, cells: manifest.cells.length, runs: artifacts.length };
}
