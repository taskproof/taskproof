"""Live browser-use integration. Imports browser-use, so it is exercised only when the
sidecar actually runs (not by the extract unit tests).

Verified live against browser-use 0.13.1 (2026-06-13): version via importlib.metadata
(no __version__), omit temperature (Opus 4.8 rejects it), usage via
agent.token_cost_service.get_usage_summary(), keep_alive=True so the session survives
agent.run() for the post-run CDP DOM probe (cdp_session.cdp_client.send.Runtime.evaluate,
matching browser-use's own pattern).

KNOWN GAP: the CDP Network listener below captures no events — page traffic flows through
per-target sessions and Network.enable is only issued on the initial session. Fixing it
needs a Target.attachedToTarget listener (or the record_har_path fallback); until then
`network` assertions won't pass for browser-use. The `_safe` wrappers keep extraction from
crashing if a 0.13.x point release shifts an accessor.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from importlib.metadata import version as _pkg_version
from typing import Any

from browser_use import Agent, Browser, ChatAnthropic

from . import extract
from .models import RunRequest

# browser-use 0.13 has no `__version__` attribute (lazy module loading); read the
# installed distribution version instead.
BROWSER_USE_VERSION = _pkg_version("browser-use")
if not BROWSER_USE_VERSION.startswith("0.13"):
    raise RuntimeError(f"taskproof sidecar targets browser-use 0.13.x; found {BROWSER_USE_VERSION}")


def _safe(fn: Callable[[], Any], default: Any) -> Any:
    try:
        return fn()
    except Exception:  # noqa: BLE001 - extraction must never crash the response
        return default


def _probe_js(selector: str) -> str:
    sel = json.dumps(selector)  # safely quote the selector into the JS source
    return (
        "(() => { const el = document.querySelector(" + sel + ");"
        " if (!el) return {exists:false, visible:false, text:null};"
        " const r = el.getBoundingClientRect();"
        " const s = getComputedStyle(el);"
        " const visible = !!(el.offsetParent !== null || s.position==='fixed')"
        "   && s.visibility!=='hidden' && s.display!=='none' && r.width>0 && r.height>0;"
        " return {exists:true, visible, text:(el.textContent||'').trim()}; })()"
    )


async def _probe_selectors(cdp: Any, selectors: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for sel in selectors:
        try:
            res = await cdp.cdp_client.send.Runtime.evaluate(
                params={"expression": _probe_js(sel), "returnByValue": True, "awaitPromise": True},
                session_id=cdp.session_id,
            )
            value = res.get("result", {}).get("value")
            if not isinstance(value, dict):
                out[sel] = {
                    "exists": False,
                    "visible": False,
                    "text": None,
                    "error": "probe returned no value",
                }
                continue
            out[sel] = {
                "exists": bool(value["exists"]),
                "visible": bool(value["visible"]),
                "text": value["text"],
            }
        except Exception as exc:  # noqa: BLE001
            out[sel] = {"exists": False, "visible": False, "text": None, "error": str(exc)}
    return out


def _thought_text(thought: Any) -> str | None:
    # model_thoughts() yields AgentBrain objects; prefer the forward-looking goal.
    for attr in ("next_goal", "evaluation_previous_goal", "memory"):
        value = getattr(thought, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(thought) if thought is not None else None


def _normalize_actions(step_actions: Any) -> list[dict[str, Any]]:
    if step_actions is None:
        return []
    items = step_actions if isinstance(step_actions, list) else [step_actions]
    out: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            out.append(item)
        elif hasattr(item, "model_dump"):
            out.append(item.model_dump(exclude_none=True))
        else:
            out.append({"action": str(item)})
    return out


def _assemble(
    req: RunRequest,
    history: Any,
    dom_probes: dict[str, dict[str, Any]],
    network: list[dict[str, Any]],
    usage_summary: Any,
    budget_exceeded: bool,
) -> dict[str, Any]:
    urls: list[Any] = _safe(history.urls, [])
    actions: list[Any] = _safe(history.action_history, [])
    thoughts: list[Any] = _safe(history.model_thoughts, [])
    errors: list[Any] = _safe(history.errors, [])
    screenshots: list[Any] = _safe(
        lambda: history.screenshots(return_none_if_not_screenshot=True), []
    )

    n = max(len(urls), len(actions), len(thoughts), len(errors), len(screenshots), 0)
    steps: list[dict[str, Any]] = []
    for i in range(n):
        error = errors[i] if i < len(errors) and errors[i] else None
        error_str = str(error) if error else None
        step_actions = _normalize_actions(actions[i] if i < len(actions) else None)
        steps.append(
            extract.build_step(
                index=i,
                text=_thought_text(thoughts[i]) if i < len(thoughts) else None,
                actions=[extract.to_action(a, error=error_str) for a in step_actions]
                or ([extract.to_action(None, error=error_str)] if error_str else []),
                screenshot_b64=screenshots[i] if i < len(screenshots) else None,
                url=str(urls[i]) if i < len(urls) and urls[i] else None,
                error=error_str,
                duration_ms=None,
            )
        )

    final_url = next((str(u) for u in reversed(urls) if u), None)
    is_done = bool(_safe(history.is_done, False))
    has_errors = bool(_safe(history.has_errors, False))
    # Usage comes from the agent's token_cost_service (async), not the history object.
    usage_obj = usage_summary
    usage = extract.build_usage(
        prompt_tokens=getattr(usage_obj, "total_prompt_tokens", 0) or 0,
        completion_tokens=getattr(usage_obj, "total_completion_tokens", 0) or 0,
        cached_tokens=getattr(usage_obj, "total_prompt_cached_tokens", 0) or 0,
        cache_creation_tokens=getattr(usage_obj, "total_prompt_cache_creation_tokens", 0) or 0,
        cost_usd=getattr(usage_obj, "total_cost", 0.0) or 0.0,
    )
    status = extract.derive_status(
        is_done=is_done,
        has_errors=has_errors,
        num_steps=n,
        max_steps=req.maxSteps,
        budget_exceeded=budget_exceeded,
    )
    return extract.assemble_response(
        status=status,
        final_url=final_url,
        steps=steps,
        network=network,
        dom_probes=dom_probes,
        usage=usage,
    )


async def run_task(req: RunRequest) -> dict[str, Any]:
    agent: Any = None
    try:
        # No temperature/top_p: Opus 4.8+ and Fable reject them (400 "deprecated for this model").
        llm = ChatAnthropic(model=req.model)  # reads ANTHROPIC_API_KEY
        browser_kwargs: dict[str, Any] = {
            "headless": req.headless,
            "window_size": {"width": req.display.widthPx, "height": req.display.heightPx},
            # keep_alive so the session survives agent.run() for the post-run DOM probe;
            # the finally block kills it explicitly.
            "keep_alive": True,
        }
        if req.allowedDomains:
            browser_kwargs["allowed_domains"] = req.allowedDomains
        browser = Browser(**browser_kwargs)
        agent = Agent(
            task=req.goal,
            llm=llm,
            browser=browser,
            initial_actions=[{"navigate": {"url": req.entryUrl, "new_tab": False}}],
            calculate_cost=True,  # REQUIRED for history.usage to populate
        )

        # Best-effort live network capture over CDP (see research risks: target/field names).
        events: dict[str, dict[str, Any]] = {}
        start = time.monotonic()
        try:
            cdp = await agent.browser_session.get_or_create_cdp_session()
            await cdp.cdp_client.send.Network.enable(session_id=cdp.session_id)

            def _on_request(evt: dict[str, Any], _session_id: str) -> None:
                events[evt["requestId"]] = {
                    "url": evt["request"]["url"],
                    "method": evt["request"]["method"],
                    "atMs": int((time.monotonic() - start) * 1000),
                }

            def _on_response(evt: dict[str, Any], _session_id: str) -> None:
                existing = events.get(evt["requestId"])
                if existing is not None:
                    existing["status"] = evt["response"]["status"]
                    existing["resourceType"] = evt.get("type")

            cdp.cdp_client.register.Network.requestWillBeSent(_on_request)
            cdp.cdp_client.register.Network.responseReceived(_on_response)
        except Exception:  # noqa: BLE001 - capture is best-effort
            pass

        history = await agent.run(max_steps=req.maxSteps)

        usage_summary: Any = None
        try:
            usage_summary = await agent.token_cost_service.get_usage_summary()
        except Exception:  # noqa: BLE001 - usage is best-effort
            usage_summary = None

        dom_probes: dict[str, dict[str, Any]] = {}
        if req.domSelectors:
            try:
                cdp = await agent.browser_session.get_or_create_cdp_session()
                dom_probes = await _probe_selectors(cdp, req.domSelectors)
            except Exception as exc:  # noqa: BLE001
                dom_probes = {
                    sel: {"exists": False, "visible": False, "text": None, "error": str(exc)}
                    for sel in req.domSelectors
                }

        return _assemble(
            req, history, dom_probes, list(events.values()), usage_summary, budget_exceeded=False
        )
    except Exception as exc:  # noqa: BLE001 - return an artifact, never a bare 500
        return extract.error_response(str(exc))
    finally:
        if agent is not None:
            try:
                await agent.browser_session.kill()
            except Exception:  # noqa: BLE001
                pass
