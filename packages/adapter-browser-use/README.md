# @taskproof/adapter-browser-use

The second runner adapter — and the proof of the moat: it drives [browser-use](https://github.com/browser-use/browser-use)
(a Python agent) through a thin FastAPI sidecar, yet emits the **identical** `RunArtifact`
and grades through the **same** `@taskproof/grader` as the Claude adapter. The only
difference between the two is which agent drove the browser.

How it stays uniform: the sidecar runs browser-use and reports raw run data plus _probe
results_ (final URL, network log, and a DOM-probe result per spec selector — evaluated via
CDP since browser-use 0.13 dropped Playwright). The TS adapter maps that into the shared
artifact and grades it. Grading logic lives in one place; the sidecar never sees the spec
or artifact schema.

## Running it

The sidecar is a `uv` project under `sidecar/`. One-time setup:

```bash
cd sidecar
uv sync                      # installs browser-use 0.13.2 + FastAPI (pinned)
uv run browser-use install   # fetches browser-use's Chromium (separate from pip)
export ANTHROPIC_API_KEY=…    # browser-use drives Claude as its LLM
uv run uvicorn taskproof_sidecar.app:app --port 8765
```

Then point the adapter at it (default `http://127.0.0.1:8765`, override with
`TASKPROOF_BROWSER_USE_URL` or `sidecarUrl`) and run:

```bash
taskproof run tasks/*.yaml --models claude-opus-4-8,browser-use
```

`browser-use` (or `browser-use:claude-sonnet-4-6`) selects this adapter; the Claude model
named is the LLM browser-use uses. Comparing `claude-opus-4-8` vs `browser-use` on the same
tasks is the headline comparison: same model, two different agent harnesses.

> Pre-release. **Not yet live-validated** end-to-end (needs the browser-use install + LLM
> credits). The TS response→artifact mapping and the sidecar's pure extraction are
> unit-tested; the live browser-use integration in `sidecar/taskproof_sidecar/runner.py` is
> a best-effort against the verified 0.13 API and carries version-sensitive markers to
> confirm at first live run (CDP probe envelope, Network event fields, history accessors).
