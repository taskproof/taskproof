"""Pure extraction/assembly of the sidecar wire response.

No browser-use import here on purpose: the runner pulls plain lists/dicts off the
AgentHistoryList and hands them to these functions, so this module is unit-testable
without the heavy browser-use install. The wire shape mirrors the TS
SidecarRunResponse in ../../src/contract.ts.
"""

from __future__ import annotations

from typing import Any


def derive_status(
    *,
    is_done: bool,
    has_errors: bool,
    num_steps: int,
    max_steps: int,
    aborted: bool = False,
) -> str:
    """Map browser-use lifecycle flags to the project's RunStatus enum.

    Pass/fail is decided later by assertions on the TS side — this is only *why the run
    stopped*, mirroring the Claude adapter's statuses. No `budget_exceeded`: taskproof can't
    enforce a $ cap mid-run for browser-use (it runs to maxSteps), so this adapter never
    produces that status — the shared enum still carries it because the Claude adapter does.
    """
    if aborted:
        return "aborted"
    if not is_done and num_steps >= max_steps:
        return "max_steps"
    if has_errors and not is_done:
        return "error"
    return "completed"


def build_usage(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    cached_tokens: int = 0,
    cache_creation_tokens: int = 0,
    cost_usd: float = 0.0,
) -> dict[str, Any]:
    """Translate browser-use's prompt/completion naming to the TS UsageArtifact shape."""
    return {
        "inputTokens": int(prompt_tokens or 0),
        "outputTokens": int(completion_tokens or 0),
        "cacheReadTokens": int(cached_tokens or 0),
        "cacheCreationTokens": int(cache_creation_tokens or 0),
        "costUsd": float(cost_usd or 0.0),
    }


def to_action(action: dict[str, Any] | None, *, error: str | None) -> dict[str, Any]:
    """One browser-use action dict -> an ActionArtifact-shaped record.

    The action dict is keyed by the action name (e.g. {"click_element_by_index": {...}}).
    """
    action = action or {}
    name = next(iter(action), "unknown") if action else "unknown"
    record: dict[str, Any] = {
        "type": name,
        "raw": action,
        "outcome": "error" if error else "ok",
    }
    if error:
        record["error"] = error
    return record


def build_step(
    *,
    index: int,
    text: str | None,
    actions: list[dict[str, Any]],
    screenshot_b64: str | None,
    url: str | None,
    error: str | None,
    duration_ms: float | None,
) -> dict[str, Any]:
    step: dict[str, Any] = {"index": index, "actions": actions}
    if text:
        step["text"] = text
    if screenshot_b64:
        step["screenshotBase64"] = screenshot_b64
    if url:
        step["url"] = url
    if error:
        step["error"] = error
    if duration_ms is not None:
        step["durationMs"] = duration_ms
    return step


def assemble_response(
    *,
    status: str,
    final_url: str | None,
    steps: list[dict[str, Any]],
    network: list[dict[str, Any]],
    dom_probes: dict[str, dict[str, Any]],
    usage: dict[str, Any],
    error: str | None = None,
    page_ready: bool | None = None,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "status": status,
        "steps": steps,
        "network": network,
        "domProbes": dom_probes,
        "usage": usage,
    }
    if final_url:
        response["finalUrl"] = final_url
    if page_ready is not None:
        response["pageReady"] = page_ready
    if error:
        response["error"] = error
    return response


def error_response(message: str, *, usage: dict[str, Any] | None = None) -> dict[str, Any]:
    """A well-formed response for a sidecar-side failure (never a bare 500)."""
    return assemble_response(
        status="error",
        final_url=None,
        steps=[],
        network=[],
        dom_probes={},
        usage=usage or build_usage(prompt_tokens=0, completion_tokens=0),
        error=message,
    )
