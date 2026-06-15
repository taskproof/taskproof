import type { JudgeInput } from './prompt.js';

/**
 * A golden case: a labeled run (`input` + the human-judged `expectPass`) plus a `response` of
 * the shape a real judge model returns. Two uses:
 *  - the in-suite regression test runs `parseVerdict(response)` and asserts it matches
 *    `expectPass` deterministically (no API) — locking the parser + prompt against drift;
 *  - the live eval (see README) runs the REAL judge over `input` and measures agreement with
 *    `expectPass` — the actual judge-quality number.
 */
export interface GoldenCase {
  name: string;
  input: JudgeInput;
  response: string;
  expectPass: boolean;
}

const checkoutOk: JudgeInput = {
  goal: "Buy the 'Sauce Labs Bolt T-Shirt' and reach the order-complete page.",
  rubric: 'The order was placed and the order-complete confirmation is shown.',
  finalUrl: 'https://www.saucedemo.com/checkout-complete.html',
  steps: [
    {
      index: 0,
      text: 'Logging in with the provided credentials.',
      actions: ['left_click', 'type'],
    },
    {
      index: 1,
      text: 'Added the t-shirt, checked out, and reached the confirmation.',
      actions: ['left_click'],
      url: 'https://www.saucedemo.com/checkout-complete.html',
    },
  ],
  assertions: [{ type: 'url', ok: true, detail: 'final URL matched **/checkout-complete.html' }],
};

const checkoutShallow: JudgeInput = {
  goal: "Buy the 'Sauce Labs Bolt T-Shirt' and reach the order-complete page.",
  rubric: 'The specific Bolt T-Shirt was purchased (not a different item) and the order completed.',
  finalUrl: 'https://www.saucedemo.com/checkout-complete.html',
  steps: [
    { index: 0, text: 'Logged in and added an item to the cart.', actions: ['left_click'] },
    {
      index: 1,
      text: 'Checked out.',
      actions: ['left_click'],
      url: 'https://www.saucedemo.com/checkout-complete.html',
    },
  ],
  assertions: [{ type: 'url', ok: true, detail: 'final URL matched **/checkout-complete.html' }],
};

const searchInput: JudgeInput = {
  goal: "Find Claude Shannon's Wikipedia article.",
  finalUrl: 'https://en.wikipedia.org/wiki/Claude_Shannon',
  steps: [{ index: 0, text: 'Searched and opened the article.', actions: ['type', 'left_click'] }],
  assertions: [{ type: 'url', ok: true, detail: 'final URL matched **/wiki/Claude_Shannon**' }],
};

export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'clean JSON pass',
    input: checkoutOk,
    response:
      '{"verdict": "pass", "reason": "Reached checkout-complete.html after adding the item and checking out."}',
    expectPass: true,
  },
  {
    name: 'clean JSON fail',
    input: checkoutShallow,
    response:
      '{"verdict": "fail", "reason": "The trajectory does not show that the BOLT t-shirt specifically was added; the item is unverified."}',
    expectPass: false,
  },
  {
    name: 'JSON inside a markdown fence',
    input: searchInput,
    response:
      '```json\n{"verdict": "pass", "reason": "Final URL is the Claude Shannon article."}\n```',
    expectPass: true,
  },
  {
    name: 'JSON wrapped in prose',
    input: checkoutShallow,
    response:
      'Based on the evidence, here is my assessment:\n{"verdict": "fail", "reason": "Order-complete URL is shown but the specific product is not confirmed in the trajectory."}\nThat is my final answer.',
    expectPass: false,
  },
  {
    name: 'uppercase verdict value (case-normalized in JSON)',
    input: searchInput,
    response: '{"verdict": "PASS", "reason": "Article reached."}',
    expectPass: true,
  },
  {
    name: 'extra JSON fields are tolerated',
    input: searchInput,
    response: '{"verdict": "pass", "reason": "ok", "confidence": 0.9, "notes": "n/a"}',
    expectPass: true,
  },
  {
    name: 'bare FAIL keyword, no JSON',
    input: checkoutShallow,
    response: 'FAIL — the evidence is insufficient to confirm the criteria.',
    expectPass: false,
  },
  {
    name: 'malformed JSON falls through and fails safe',
    input: checkoutShallow,
    response: '{"verdict": }',
    expectPass: false,
  },
  {
    name: 'no recoverable verdict fails safe',
    input: checkoutShallow,
    response: 'I was unable to evaluate the run with the information available.',
    expectPass: false,
  },
  {
    name: 'empty response fails safe',
    input: checkoutShallow,
    response: '',
    expectPass: false,
  },
  // --- adversarial: the false-positive vectors a keyword fallback would mis-pass ---
  {
    name: 'FAIL prose containing the word "pass" (no JSON)',
    input: checkoutShallow,
    response: 'The agent did not pass the check; it never reached checkout.',
    expectPass: false,
  },
  {
    name: 'FAIL prose with "pass" before "fail" (no JSON)',
    input: checkoutShallow,
    response: 'It could not pass the verification step, so this is a fail.',
    expectPass: false,
  },
  {
    name: 'conflicting JSON objects fail safe',
    input: checkoutShallow,
    response: '{"verdict":"pass"} {"verdict":"fail"}',
    expectPass: false,
  },
  {
    name: 'broken JSON with stray braces + failure prose',
    input: checkoutShallow,
    response: '{oops}: the agent failed to pass the gate and stopped.',
    expectPass: false,
  },
  {
    name: 'whitespace-only fails safe',
    input: checkoutShallow,
    response: '   \n\t  ',
    expectPass: false,
  },
  {
    name: 'valid fail JSON survives a trailing prose footnote with a stray brace',
    input: checkoutShallow,
    response: '{"verdict":"fail","reason":"item unconfirmed"} (see note {ref})',
    expectPass: false,
  },
  {
    name: 'JSON fail whose reason contains "passed" stays fail',
    input: checkoutShallow,
    response: '{"verdict":"fail","reason":"the agent never passed the gate"}',
    expectPass: false,
  },
  {
    name: 'refusal arguing failure without the word "fail"',
    input: checkoutShallow,
    response: 'I cannot confirm the task was completed based on the evidence provided.',
    expectPass: false,
  },
];
