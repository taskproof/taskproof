import { z } from 'zod';

/** The parsed judge verdict (before the prompt version + cost are stamped on by `judgeRun`). */
export interface ParsedVerdict {
  pass: boolean;
  reasoning: string;
}

const rawVerdictSchema = z.object({
  // String (not enum) so we can normalize case ourselves; non-pass/fail values are ignored.
  verdict: z.string(),
  reason: z.string().optional(),
});

/**
 * Extract every top-level balanced `{...}` object, ignoring braces that appear inside JSON
 * string values. Returns each candidate separately so a response with multiple/contradictory
 * objects (or stray braces in prose) can be detected rather than mis-sliced.
 */
function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Parse a judge model's response into a verdict. **Safe by construction:** the verdict is
 * `pass` ONLY when the response contains at least one well-formed JSON verdict object and
 * EVERY such object says "pass". Anything else — no JSON, malformed JSON, prose, or
 * conflicting verdicts — fails safe (`pass: false`). There is deliberately no prose-keyword
 * fallback: a judge that didn't emit a clean JSON verdict has not answered, and per the
 * deterministic-first doctrine an unanswered judge can never green-light a run. (The judge is
 * instructed to reply with only a JSON object; non-JSON is a degraded path.)
 */
export function parseVerdict(text: string): ParsedVerdict {
  const verdicts: ParsedVerdict[] = [];
  for (const candidate of extractJsonObjects(text)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = rawVerdictSchema.safeParse(value);
    if (!result.success) continue;
    const word = result.data.verdict.trim().toLowerCase();
    if (word !== 'pass' && word !== 'fail') continue;
    verdicts.push({ pass: word === 'pass', reasoning: result.data.reason ?? '' });
  }

  if (verdicts.length === 0) {
    return {
      pass: false,
      reasoning: `no parseable JSON verdict in the judge response: "${text.trim().slice(0, 140)}"`,
    };
  }

  const fail = verdicts.find((v) => !v.pass);
  if (fail !== undefined) {
    // Any fail — including a pass/fail contradiction — fails safe.
    const conflicted = verdicts.some((v) => v.pass);
    return {
      pass: false,
      reasoning: conflicted
        ? `conflicting judge verdicts; failing safe. ${fail.reasoning}`.trim()
        : fail.reasoning,
    };
  }

  // At least one verdict object, and every one says pass.
  return { pass: true, reasoning: verdicts[0]?.reasoning ?? '' };
}
