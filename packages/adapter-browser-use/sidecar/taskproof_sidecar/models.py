"""Request model for the sidecar. Field names mirror the TS wire contract (camelCase)."""

from __future__ import annotations

from pydantic import BaseModel


class Display(BaseModel):
    widthPx: int
    heightPx: int


class RunRequest(BaseModel):
    goal: str
    entryUrl: str
    maxSteps: int
    model: str
    display: Display
    headless: bool = True
    domSelectors: list[str] = []
    allowedDomains: list[str] | None = None
    # Wall-clock cap in ms, REALLY enforced (app.py wraps run_task in asyncio.wait_for and kills
    # the browser on timeout). A time limit is enforceable mid-run, so this field is honest.
    timeoutMs: int | None = None
    # No maxCostUsd: taskproof can't enforce a $ cap mid-run for browser-use (it runs to
    # maxSteps), so the sidecar doesn't accept a field that would falsely imply it does.
