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

import asyncio
import json
import shutil
import tempfile
from collections.abc import Callable
from datetime import datetime
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

# Upper bound on how long we *wait* for the post-run browser teardown. Caps how long a wedged
# Chromium can hold the shared sidecar run lock (the run body itself is bounded separately by
# app.py's wait_for). Past this we stop waiting but let the kill finish in the background.
KILL_TIMEOUT_S = 15.0

# Strong refs to background teardown tasks so the event loop doesn't GC a still-pending kill
# ("Task was destroyed but it is pending!"); the done-callback drops each when it finishes.
_pending_teardowns: set[asyncio.Task[Any]] = set()


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


async def _probe_page_ready(cdp: Any) -> bool | None:
    """Did the final page render real content (body has child elements)? Lets the grader
    reject a vacuous `absent` pass on a blank/failed page. None if it can't be determined."""
    try:
        res = await cdp.cdp_client.send.Runtime.evaluate(
            params={
                "expression": "!!(document.body && document.body.childElementCount > 0)",
                "returnByValue": True,
            },
            session_id=cdp.session_id,
        )
        value = res.get("result", {}).get("value")
        return bool(value) if isinstance(value, bool) else None
    except Exception:  # noqa: BLE001 - readiness is best-effort
        return None


def _parse_har(path: str) -> list[dict[str, Any]]:
    """Parse a HAR file (written by browser-use's HarRecordingWatchdog on stop) into the
    NetworkEvent shape. `atMs` is milliseconds since the earliest request. HTTPS only —
    the watchdog doesn't capture plain HTTP."""
    try:
        with open(path) as f:
            har = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    entries = har.get("log", {}).get("entries", [])
    parsed: list[tuple[float | None, dict[str, Any]]] = []
    for entry in entries:
        request = entry.get("request", {})
        url, method = request.get("url"), request.get("method")
        if not url or not method:
            continue
        ts: float | None = None
        started = entry.get("startedDateTime")
        if isinstance(started, str):
            try:
                ts = datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp()
            except ValueError:
                ts = None
        event: dict[str, Any] = {"url": url, "method": method}
        status = entry.get("response", {}).get("status")
        if isinstance(status, int) and status > 0:
            event["status"] = status
        resource_type = entry.get("_resourceType") or request.get("_resourceType")
        if resource_type:
            event["resourceType"] = resource_type
        parsed.append((ts, event))
    base = min((t for t, _ in parsed if t is not None), default=None)
    for ts, event in parsed:
        event["atMs"] = int((ts - base) * 1000) if ts is not None and base is not None else 0
    return [event for _, event in parsed]


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
    page_ready: bool | None = None,
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
    # No budget_exceeded: taskproof can't enforce a $ cap mid-run for browser-use (it runs to
    # maxSteps), so this adapter never reports that status — maxSteps is the real bound.
    status = extract.derive_status(
        is_done=is_done,
        has_errors=has_errors,
        num_steps=n,
        max_steps=req.maxSteps,
    )
    return extract.assemble_response(
        status=status,
        final_url=final_url,
        steps=steps,
        network=network,
        dom_probes=dom_probes,
        usage=usage,
        page_ready=page_ready,
    )


async def run_task(req: RunRequest) -> dict[str, Any]:
    agent: Any = None
    killed = False
    # Network is captured via browser-use's HarRecordingWatchdog (record_har_path), flushed
    # on browser stop. HTTPS only. It reliably captures same-origin traffic (the site's own
    # API calls — the common network-assertion case), but the watchdog only enables Network
    # on the initial session, so a cross-origin navigation to a NEW target is missed. Full
    # cross-origin capture would need per-target Network.enable via Target.attachedToTarget.
    har_dir = tempfile.mkdtemp(prefix="taskproof-har-")
    har_path = f"{har_dir}/net.har"
    try:
        # No temperature/top_p: Opus 4.8+ and Fable reject them (400 "deprecated for this model").
        llm = ChatAnthropic(model=req.model)  # reads ANTHROPIC_API_KEY
        browser_kwargs: dict[str, Any] = {
            "headless": req.headless,
            "window_size": {"width": req.display.widthPx, "height": req.display.heightPx},
            # keep_alive so the session survives agent.run() for the post-run DOM probe.
            "keep_alive": True,
            "record_har_path": har_path,
            "record_har_mode": "minimal",
            "record_har_content": "omit",
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

        history = await agent.run(max_steps=req.maxSteps)

        usage_summary: Any = None
        try:
            usage_summary = await agent.token_cost_service.get_usage_summary()
        except Exception:  # noqa: BLE001 - usage is best-effort
            usage_summary = None

        # DOM probe while the session is still alive (visibility needs live layout). Also grab
        # page readiness so the grader can reject a vacuous `absent` pass on a blank/failed page.
        dom_probes: dict[str, dict[str, Any]] = {}
        page_ready: bool | None = None
        if req.domSelectors:
            try:
                cdp = await agent.browser_session.get_or_create_cdp_session()
                dom_probes = await _probe_selectors(cdp, req.domSelectors)
                page_ready = await _probe_page_ready(cdp)
            except Exception as exc:  # noqa: BLE001
                dom_probes = {
                    sel: {"exists": False, "visible": False, "text": None, "error": str(exc)}
                    for sel in req.domSelectors
                }

        # Stop the browser now so the HAR watchdog flushes the file, then parse it.
        try:
            await agent.browser_session.kill()
            killed = True
        except Exception:  # noqa: BLE001
            pass
        network = _parse_har(har_path)

        return _assemble(
            req,
            history,
            dom_probes,
            network,
            usage_summary,
            page_ready=page_ready,
        )
    except Exception as exc:  # noqa: BLE001 - return an artifact, never a bare 500
        return extract.error_response(str(exc))
    finally:
        if agent is not None and not killed:
            # Bound the teardown. On a wall-clock timeout this `finally` runs under cancellation,
            # and `asyncio.wait_for` won't raise TimeoutError (nor release the caller's run lock)
            # until it completes — but `kill()` does a CDP round-trip (SaveStorageStateEvent)
            # against the possibly-wedged browser, internally bounded only by browser-use's ~300s
            # event timeout. Without a guard, a hung browser would hold the shared sidecar lock for
            # minutes, blocking every later run. So run kill() as its own task and wait at most
            # KILL_TIMEOUT_S: past that we stop waiting (the lock frees) but let it finish in the
            # background — terminating Chromium rather than leaking the process. `shield` keeps the
            # kill alive when our wait_for cancels; `_pending_teardowns` keeps a strong ref.
            kill_task = asyncio.ensure_future(agent.browser_session.kill())
            _pending_teardowns.add(kill_task)
            kill_task.add_done_callback(_pending_teardowns.discard)
            try:
                await asyncio.wait_for(asyncio.shield(kill_task), timeout=KILL_TIMEOUT_S)
            except Exception:  # noqa: BLE001 - best-effort teardown (incl. TimeoutError)
                pass
        shutil.rmtree(har_dir, ignore_errors=True)
