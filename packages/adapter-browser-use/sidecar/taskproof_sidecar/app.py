"""FastAPI surface for the taskproof browser-use sidecar.

One long-lived process per `taskproof run`, reused across the pass@k loop and the matrix.
Runs are serialized (one Chromium, one agent at a time).

    uv run uvicorn taskproof_sidecar.app:app --port 8765
"""

from __future__ import annotations

import asyncio

import browser_use
from fastapi import FastAPI

from . import extract
from .models import RunRequest
from .runner import run_task

app = FastAPI(title="taskproof browser-use sidecar")
_run_lock = asyncio.Lock()


@app.get("/health")
async def health() -> dict[str, object]:
    return {"ready": True, "browserUseVersion": browser_use.__version__}


@app.post("/run")
async def run(req: RunRequest) -> dict[str, object]:
    # Serialize: a single browser/agent at a time. The TS adapter sets its own timeout.
    async with _run_lock:
        try:
            return await run_task(req)
        except Exception as exc:  # noqa: BLE001 - always return a well-formed artifact
            return extract.error_response(str(exc))
