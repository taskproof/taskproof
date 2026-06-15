# @taskproof/judge

The optional **LLM judge** — the WebJudge layer. Deterministic `url`/`dom`/`network`
assertions decide the verdict first; when a spec sets a `judge` rubric, this evaluates whether
the agent _genuinely accomplished the goal_ from the run's evidence, and only runs on runs that
already passed the deterministic checks (**deterministic first, LLM second**). It can turn a
deterministic-pass into a fail (catching "the URL matched but the task wasn't really done"); it
never rescues a deterministic fail.

After the Online-Mind2Web / WebJudge recipe (arXiv 2504.01382): goal + rubric + trajectory +
the passed deterministic checks → an evidence-grounded pass/fail. v1 judges from the text
trajectory + final URL; key-screenshot evidence is the next iteration.

- **The prompt is versioned** (`JUDGE_PROMPT_VERSION`) and recorded on every verdict.
- **The logic is pure and testable** — `buildJudgePrompt` + `parseVerdict`; the only impure
  part is `createAnthropicJudge`, which backs the `Complete` function with the Messages API.
- **Fails safe** — an API/parse failure becomes a failing verdict, never a silent pass.

## Grading the grader

`src/golden.ts` is a labeled golden set. Two layers:

- **In-suite regression (no API):** `test/judge.test.ts` parses each case's reference response
  and asserts it matches the label — locking the parser + prompt format against drift. This is
  what `pnpm test` runs.
- **Live judge-quality eval (needs `ANTHROPIC_API_KEY`):** run the real judge over the golden
  inputs and measure agreement with the labels. Bump `JUDGE_PROMPT_VERSION` and re-run this
  before changing the prompt:

  ```ts
  import { GOLDEN_CASES, createAnthropicJudge, judgeRun } from '@taskproof/judge';
  const complete = createAnthropicJudge();
  for (const c of GOLDEN_CASES) {
    const v = await judgeRun(c.input, complete);
    console.log(c.name, v.pass === c.expectPass ? 'agree' : 'DISAGREE', v.reasoning);
  }
  ```
