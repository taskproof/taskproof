import { readFile } from 'node:fs/promises';

import { TaskSpecValidationError, safeParseTaskSpec } from '@gauntlet/spec';

export interface FileResult {
  file: string;
  ok: boolean;
  id?: string;
  errors: string[];
}

export async function validateFiles(files: string[]): Promise<FileResult[]> {
  return Promise.all(
    files.map(async (file): Promise<FileResult> => {
      let source: string;
      try {
        source = await readFile(file, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { file, ok: false, errors: [`cannot read file: ${message}`] };
      }

      // No filename option: formatFileResult already prints the file as the header line.
      const result = safeParseTaskSpec(source);
      if (result.ok) {
        return { file, ok: true, id: result.spec.id, errors: [] };
      }

      const errors =
        result.error instanceof TaskSpecValidationError
          ? result.error.issues.map((issue) =>
              issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`,
            )
          : [result.error.message];
      return { file, ok: false, errors };
    }),
  );
}

export function formatFileResult(result: FileResult): string {
  if (result.ok) {
    return `✓ ${result.file} (${result.id ?? 'unknown id'})`;
  }
  const details = result.errors
    .flatMap((error) => error.split('\n'))
    .map((line) => `    ${line}`)
    .join('\n');
  return `✗ ${result.file}\n${details}`;
}
