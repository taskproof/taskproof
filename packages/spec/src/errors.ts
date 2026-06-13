/** A single validation problem, with a dotted/bracketed path into the document. */
export interface SpecIssue {
  path: string;
  message: string;
}

export class TaskSpecError extends Error {
  readonly filename: string | undefined;

  constructor(message: string, filename?: string) {
    super(filename === undefined ? message : `${filename}: ${message}`);
    this.name = 'TaskSpecError';
    this.filename = filename;
  }
}

/** The source is not parseable YAML at all. */
export class TaskSpecYamlError extends TaskSpecError {
  constructor(message: string, filename?: string) {
    super(message, filename);
    this.name = 'TaskSpecYamlError';
  }
}

/** The document declares a specVersion this library does not support (or omits it). */
export class UnsupportedSpecVersionError extends TaskSpecError {
  readonly version: string | undefined;
  readonly supported: readonly string[];

  constructor(version: string | undefined, supported: readonly string[], filename?: string) {
    const detail =
      version === undefined
        ? 'missing required field `specVersion`'
        : `unsupported specVersion "${version}"`;
    super(`${detail} (supported: ${supported.join(', ')})`, filename);
    this.name = 'UnsupportedSpecVersionError';
    this.version = version;
    this.supported = supported;
  }
}

/** The document is well-formed YAML with a known version, but fails schema validation. */
export class TaskSpecValidationError extends TaskSpecError {
  readonly issues: readonly SpecIssue[];

  constructor(issues: readonly SpecIssue[], filename?: string) {
    const lines = issues.map((issue) =>
      issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`,
    );
    super(`invalid task spec:\n  - ${lines.join('\n  - ')}`, filename);
    this.name = 'TaskSpecValidationError';
    this.issues = issues;
  }
}
