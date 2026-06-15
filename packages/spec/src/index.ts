export {
  K_MAX,
  MAX_COST_USD,
  SPEC_VERSION,
  assertionSchema,
  passPolicySchema,
  taskSpecSchema,
  type Assertion,
  type PassPolicy,
  type TaskSpec,
  type TaskSpecInput,
} from './schema.js';

export {
  SUPPORTED_SPEC_VERSIONS,
  parseTaskSpec,
  safeParseTaskSpec,
  type ParseOptions,
  type SafeParseResult,
} from './parse.js';

export {
  TaskSpecError,
  TaskSpecValidationError,
  TaskSpecYamlError,
  UnsupportedSpecVersionError,
  type SpecIssue,
} from './errors.js';
