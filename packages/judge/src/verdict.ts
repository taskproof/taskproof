import { z } from 'zod';

/** The parsed judge verdict (before the prompt version is stamped on by `judgeRun`). */
export interface ParsedVerdict {
  pass: boolean;
  reasoning: string;
}

const rawVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  reason: z.string().optional(),
});

/** Pull the first balanced-looking JSON object out of a string (tolerant of fences/prose). */
function extractJsonObject(text: string): string | undefined {
  const fenced = text.replace(/```(?:json)?/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  return fenced.slice(start, end + 1);
}

/**
 * Parse a judge model's response into a verdict. Tolerant by design — real responses arrive
 * as clean JSON, JSON in a ```fence, JSON wrapped in prose, or (rarely) bare PASS/FAIL. A
 * response with no recoverable verdict FAILS SAFE (`pass: false`) so a judge that didn't
 * actually answer can never green-light a run.
 */
export function parseVerdict(text: string): ParsedVerdict {
  const candidate = extractJsonObject(text);
  if (candidate !== undefined) {
    try {
      const parsed = rawVerdictSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return { pass: parsed.data.verdict === 'pass', reasoning: parsed.data.reason ?? '' };
      }
    } catch {
      // fall through to the keyword fallback
    }
  }

  // Fallback: a bare/explicit PASS or FAIL keyword (first occurrence wins).
  const match = /\b(pass|fail)\b/i.exec(text);
  if (match) {
    const word = match[1]?.toLowerCase();
    return {
      pass: word === 'pass',
      reasoning: text.trim().slice(0, 280),
    };
  }

  return {
    pass: false,
    reasoning: `could not parse a verdict from the judge response: "${text.trim().slice(0, 140)}"`,
  };
}
