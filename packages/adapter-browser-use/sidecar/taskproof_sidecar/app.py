"""FastAPI surface for the taskproof browser-use sidecar.

One long-lived process per `taskproof run`, reused across the pass@k loop and the matrix.
Runs are serialized (one Chromium, one agent at a time).

    uv run uvicorn taskproof_sidecar.app:app --port 8765
"""

from __future__ import annotations

import asyncio

from fastapi import FastAPI

from . import extract
from .models import RunRequest
from .runner import BROWSER_USE_VERSION, run_task

app = FastAPI(title="taskproof browser-use sidecar")
_run_lock = asyncio.Lock()

# Generous wall-clock ceiling when the request doesn't set one. The TS adapter normally sends a
# tighter timeoutMs; this just bounds a run that somehow arrives without one.
DEFAULT_TIMEOUT_S = 600.0


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ready": True, "browserUseVersion": BROWSER_USE_VERSION}


@app.post("/run")
async def run(req: RunRequest) -> dict[str, object]:
    timeout_s = req.timeoutMs / 1000 if req.timeoutMs else DEFAULT_TIMEOUT_S
    # Serialize: a single browser/agent at a time. asyncio.wait_for enforces a real wall-clock cap
    # — on timeout it cancels run_task, whose `finally` kills the Chromium session, then the lock
    # releases. Without this, a hung run would orphan the browser AND wedge the lock for every
    # later run (the TS adapter aborting its fetch alone wouldn't stop the work in here).
    async with _run_lock:
        try:
            return await asyncio.wait_for(run_task(req), timeout=timeout_s)
        except TimeoutError:
            # A wall-clock timeout is a deliberate stop, not a failure — mark it 'aborted' (the
            # shared RunStatus meaning) so it matches the Claude adapter's timeout status, not
            # 'error'. The message still explains what happened.
            return extract.error_response(
                f"run exceeded the {timeout_s:.0f}s sidecar timeout — Chromium was killed. "
                "Lower the task's maxSteps or raise --timeout.",
                status="aborted",
            )
        except Exception as exc:  # noqa: BLE001 - always return a well-formed artifact
            return extract.error_response(str(exc))
