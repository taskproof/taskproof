import { z } from 'zod';

/** The current task-spec format version. Bump only via the RFC process once published. */
export const SPEC_VERSION = '0.1';

/**
 * A hostname, optionally with a single leading `*.` wildcard to allow subdomains
 * (checkout flows commonly hop to e.g. `checkout.example.com`). Single-label names
 * like `localhost` are allowed for sandbox targets.
 */
const domainPattern = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const allowedDomainSchema = z
  .string()
  .regex(domainPattern, 'must be a hostname like "example.com", "*.example.com", or "localhost"');

const urlAssertionSchema = z.strictObject({
  type: z.literal('url'),
  /** Glob-style pattern matched against the final page URL, e.g. `**\/checkout/success*`. */
  pattern: z.string().min(1),
  description: z.string().optional(),
});

const domAssertionSchema = z.strictObject({
  type: z.literal('dom'),
  /** CSS selector evaluated against the final DOM. */
  selector: z.string().min(1),
  /**
   * What must hold for the selector in the final DOM:
   * - `visible` (default): at least one match is laid out and visible.
   * - `attached`: at least one match exists in the DOM (visible or not).
   * - `text`: a match exists and its text contains `text`.
   * - `absent`: NO element matches (e.g. a dialog the agent dismissed was removed).
   * - `hidden`: a match exists but is not visible (e.g. a modal closed to `display:none`).
   *   Use `absent`/`hidden` to grade "the agent cleared the overlay/dialog".
   *
   * SOUNDNESS: a negative check (`absent`, or `hidden` against an element that starts hidden)
   * can pass *vacuously* — a failed/blank/wrong page also has no/invisible element. Always
   * pair a negative dom check with a positive anchor (a `url` match, or a `visible`/`text`
   * check, or a `network` request that only the intended action triggers) so a page that
   * never loaded the element cannot be graded as a successful dismissal.
   */
  state: z.enum(['visible', 'attached', 'text', 'absent', 'hidden']).default('visible'),
  /** Required when `state` is "text": substring the selected element's text must contain. */
  text: z.string().min(1).optional(),
  description: z.string().optional(),
});

const networkAssertionSchema = z.strictObject({
  type: z.literal('network'),
  /** Glob-style pattern matched against request URLs observed during the run. */
  urlPattern: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  /** Exact status code (e.g. 200) or a class like "2xx". */
  status: z
    .union([
      z.number().int().min(100).max(599),
      z.string().regex(/^[1-5]xx$/, 'status class must look like "2xx"'),
    ])
    .optional(),
  description: z.string().optional(),
});

export const assertionSchema = z
  .discriminatedUnion('type', [urlAssertionSchema, domAssertionSchema, networkAssertionSchema])
  .superRefine((assertion, ctx) => {
    if (assertion.type !== 'dom') return;
    if (assertion.state === 'text' && assertion.text === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: '`text` is required when state is "text"',
      });
    }
    if (assertion.state !== 'text' && assertion.text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: '`text` is only allowed when state is "text"',
      });
    }
  });

/**
 * pass@k policy: run the task `k` times; it passes if at least `minPasses` runs pass.
 * Agents are non-deterministic — a statistical threshold, never a binary gate.
 */
export const passPolicySchema = z
  .strictObject({
    k: z.number().int().min(1).max(25),
    minPasses: z.number().int().min(1),
  })
  .refine((policy) => policy.minPasses <= policy.k, {
    message: 'minPasses cannot exceed k',
    path: ['minPasses'],
  });

const taskSpecObjectSchema = z.strictObject({
  specVersion: z.literal(SPEC_VERSION),
  /** Stable kebab-case identifier; used in reports, baselines, and diffs. */
  id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      'id must be kebab-case: lowercase letters, digits, hyphens',
    ),
  /** Natural-language goal handed to the agent, e.g. "Find the price of the Team plan and start a free trial". */
  goal: z.string().min(1).max(2000),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  entryUrl: z
    .url({ protocol: /^https?$/, error: 'entryUrl must be an http(s) URL' })
    .refine((value) => {
      // This refinement also runs when the URL format check above has already failed.
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return true;
      }
      return url.username === '' && url.password === '';
    }, 'entryUrl must not contain credentials (user:pass@) — specs are persisted into reports and run artifacts'),
  /** Hostnames the agent may visit. Defaults to the entryUrl hostname. */
  allowedDomains: z
    .array(allowedDomainSchema)
    .min(1, 'allowedDomains must not be empty — omit the field to default to the entryUrl hostname')
    .optional(),
  /** Hard cap on agent steps before the run is marked failed. */
  maxSteps: z
    .number({ error: 'maxSteps must be a finite number (e.g. 20)' })
    .int()
    .min(1)
    .max(200)
    .default(20),
  /** Optional hard budget cap for a single run of this task, in USD. */
  maxCostUsd: z
    .number({ error: 'maxCostUsd must be a finite number of US dollars (e.g. 1.50)' })
    .positive()
    .max(1000, 'maxCostUsd is a per-run cap; values over 1000 USD are almost certainly a mistake')
    .optional(),
  /**
   * Defaults to a single run — fine for local smoke checks; CI gating should set k >= 3
   * with a threshold (the run layer will warn when a PR gate uses k = 1).
   */
  passPolicy: passPolicySchema.default({ k: 1, minPasses: 1 }),
  /** Deterministic success assertions; all must hold for a run to pass. */
  assertions: z.array(assertionSchema).min(1),
});

// Zod runs object-level refinements and transforms even when a field check has already
// failed, so everything below must tolerate an entryUrl that is not a parseable URL.
function deriveAllowedDomain(entryUrl: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(entryUrl).hostname;
  } catch {
    return undefined;
  }
  hostname = hostname.replace(/\.$/, '');
  return domainPattern.test(hostname) ? hostname : undefined;
}

export const taskSpecSchema = taskSpecObjectSchema
  .superRefine((spec, ctx) => {
    if (spec.allowedDomains !== undefined || deriveAllowedDomain(spec.entryUrl) !== undefined) {
      return;
    }
    if (!URL.canParse(spec.entryUrl)) return; // already flagged by the entryUrl check
    ctx.addIssue({
      code: 'custom',
      path: ['allowedDomains'],
      message: `cannot derive allowedDomains from entryUrl host "${new URL(spec.entryUrl).hostname}" — specify allowedDomains explicitly`,
    });
  })
  .transform((spec) => {
    const derived = deriveAllowedDomain(spec.entryUrl);
    return {
      ...spec,
      // The empty-array branch is unreachable on valid input: the superRefine above
      // rejects specs whose entryUrl host cannot be derived.
      allowedDomains: spec.allowedDomains ?? (derived === undefined ? [] : [derived]),
    };
  });

export type TaskSpec = z.output<typeof taskSpecSchema>;
export type TaskSpecInput = z.input<typeof taskSpecSchema>;
export type Assertion = z.output<typeof assertionSchema>;
export type PassPolicy = z.output<typeof passPolicySchema>;
