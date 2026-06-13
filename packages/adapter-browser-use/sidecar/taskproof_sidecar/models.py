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
    maxCostUsd: float | None = None
