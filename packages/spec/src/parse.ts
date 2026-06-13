import { parse as parseYamlSource } from 'yaml';

import {
  TaskSpecError,
  TaskSpecValidationError,
  TaskSpecYamlError,
  UnsupportedSpecVersionError,
} from './errors.js';
import { SPEC_VERSION, taskSpecSchema, type TaskSpec } from './schema.js';

export const SUPPORTED_SPEC_VERSIONS: readonly string[] = [SPEC_VERSION];

// A Map, not a plain object: version strings come from user input, and a plain-object
// lookup would let prototype keys ("toString", "constructor") resolve to functions.
const schemasByVersion = new Map<string, typeof taskSpecSchema>([[SPEC_VERSION, taskSpecSchema]]);

export interface ParseOptions {
  /** Used to prefix error messages, e.g. the path of the file being parsed. */
  filename?: string;
}

export type SafeParseResult = { ok: true; spec: TaskSpec } | { ok: false; error: TaskSpecError };

/** Parse and validate a single YAML task spec. Throws a `TaskSpecError` subclass on any problem. */
export function parseTaskSpec(source: string, options: ParseOptions = {}): TaskSpec {
  const result = safeParseTaskSpec(source, options);
  if (!result.ok) throw result.error;
  return result.spec;
}

/** Non-throwing variant of `parseTaskSpec`. */
export function safeParseTaskSpec(source: string, options: ParseOptions = {}): SafeParseResult {
  const { filename } = options;

  let document: unknown;
  try {
    document = parseYamlSource(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: new TaskSpecYamlError(message, filename) };
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return {
      ok: false,
      error: new TaskSpecValidationError(
        [{ path: '', message: 'a task spec must be a YAML mapping (key: value pairs)' }],
        filename,
      ),
    };
  }

  const record = document as Record<string, unknown>;

  // An own `__proto__` key is never legitimate spec data; reject it explicitly rather than
  // relying on it surviving every spread/iteration between here and the strict schema.
  if (Object.prototype.hasOwnProperty.call(record, '__proto__')) {
    return {
      ok: false,
      error: new TaskSpecValidationError(
        [{ path: '', message: 'Unrecognized key: "__proto__"' }],
        filename,
      ),
    };
  }

  const rawVersion = record['specVersion'];

  if (rawVersion === undefined) {
    return {
      ok: false,
      error: new UnsupportedSpecVersionError(undefined, SUPPORTED_SPEC_VERSIONS, filename),
    };
  }

  if (typeof rawVersion !== 'string') {
    // YAML reads an unquoted `specVersion: 0.1` as a number — and numbers cannot round-trip
    // version strings (0.10 becomes 0.1), so we insist on a string instead of guessing.
    const hint =
      typeof rawVersion === 'number' ? ` — quote it, e.g. specVersion: "${SPEC_VERSION}"` : '';
    return {
      ok: false,
      error: new TaskSpecValidationError(
        [
          {
            path: 'specVersion',
            message: `specVersion must be a string (got ${typeof rawVersion})${hint}`,
          },
        ],
        filename,
      ),
    };
  }

  const schema = schemasByVersion.get(rawVersion);
  if (schema === undefined) {
    return {
      ok: false,
      error: new UnsupportedSpecVersionError(rawVersion, SUPPORTED_SPEC_VERSIONS, filename),
    };
  }

  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    }));
    return { ok: false, error: new TaskSpecValidationError(issues, filename) };
  }

  return { ok: true, spec: parsed.data };
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out;
}
