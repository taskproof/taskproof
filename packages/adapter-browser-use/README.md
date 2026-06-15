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
uv sync                      # installs browser-use 0.13.1 + FastAPI (pinned)
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

> Pre-release. **Live-validated 2026-06-13 against browser-use 0.13.1**: a real
> `taskproof run --models browser-use` reached the target, the CDP DOM probe and the `url`
> assertion both graded correctly through the shared grader, and token cost was extracted
> (~$0.24 for a 3-step task). Verified API details now in `runner.py`: omit `temperature`
> (Opus 4.8 rejects it), read the version via `importlib.metadata`, get usage from
> `agent.token_cost_service.get_usage_summary()`, and set `keep_alive=True` so the session
> survives `agent.run()` for the post-run DOM probe.
>
> **Network capture (HAR-based):** uses browser-use's `HarRecordingWatchdog`
> (`record_har_path`), validated live — it captures **same-origin** HTTPS traffic (the
> site's own API calls, the common `network`-assertion case). Remaining edge: the watchdog
> only enables CDP `Network` on the initial session, so a **cross-origin navigation** to a
> new target is missed; full coverage would need per-target `Network.enable` via
> `Target.attachedToTarget`. HTTP (non-TLS) isn't captured.
>
> **Budget cap (`maxCostUsd` / `--max-cost`) is NOT enforced mid-run here.** Unlike the Claude
> adapter, which gates each turn against the cap before paying, taskproof can't stop a
> browser-use run partway — it runs to its own completion or `maxSteps`. The cap is therefore
> advisory for this adapter: cost may exceed it (the report shows the real figure), and the CLI
> warns when you pass `--max-cost` with a browser-use model. **`maxSteps` is the hard bound on
> browser-use spend** — lower it to bound cost.
