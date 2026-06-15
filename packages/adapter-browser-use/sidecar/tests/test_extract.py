"""Unit tests for the pure extraction layer (no browser-use import needed)."""

from __future__ import annotations

from taskproof_sidecar import extract


def test_derive_status_completed():
    assert (
        extract.derive_status(is_done=True, has_errors=False, num_steps=3, max_steps=20)
        == "completed"
    )


def test_derive_status_max_steps():
    assert (
        extract.derive_status(is_done=False, has_errors=False, num_steps=20, max_steps=20)
        == "max_steps"
    )


def test_derive_status_error_when_unfinished_with_errors():
    assert (
        extract.derive_status(is_done=False, has_errors=True, num_steps=4, max_steps=20) == "error"
    )


def test_derive_status_abort_takes_precedence():
    # `aborted` wins over a max_steps/error condition. (No budget_exceeded case: browser-use
    # is never budget-capped mid-run, so this adapter never produces that status.)
    assert (
        extract.derive_status(
            is_done=False, has_errors=True, num_steps=20, max_steps=20, aborted=True
        )
        == "aborted"
    )


def test_build_usage_translates_prompt_completion_to_input_output():
    usage = extract.build_usage(
        prompt_tokens=12000, completion_tokens=600, cached_tokens=8000, cost_usd=0.18
    )
    assert usage == {
        "inputTokens": 12000,
        "outputTokens": 600,
        "cacheReadTokens": 8000,
        "cacheCreationTokens": 0,
        "costUsd": 0.18,
    }


def test_to_action_uses_dict_key_as_type_and_marks_errors():
    ok = extract.to_action({"click_element_by_index": {"index": 3}}, error=None)
    assert ok["type"] == "click_element_by_index"
    assert ok["outcome"] == "ok"
    assert "error" not in ok

    bad = extract.to_action({"input_text": {"text": "x"}}, error="element not found")
    assert bad["outcome"] == "error"
    assert bad["error"] == "element not found"


def test_assemble_response_shape_matches_wire_contract():
    response = extract.assemble_response(
        status="completed",
        final_url="https://x.com/done",
        steps=[
            extract.build_step(
                index=0,
                text="did a thing",
                actions=[extract.to_action({"done": {}}, error=None)],
                screenshot_b64="AAAA",
                url="https://x.com/done",
                error=None,
                duration_ms=120,
            )
        ],
        network=[{"url": "https://x.com/api", "method": "GET", "status": 200, "atMs": 50}],
        dom_probes={"h1": {"exists": True, "visible": True, "text": "Hi"}},
        usage=extract.build_usage(prompt_tokens=1, completion_tokens=1),
    )
    assert response["status"] == "completed"
    assert response["finalUrl"] == "https://x.com/done"
    assert response["steps"][0]["screenshotBase64"] == "AAAA"
    assert response["domProbes"]["h1"]["visible"] is True
    assert "error" not in response


def test_error_response_is_well_formed():
    err = extract.error_response("sidecar blew up")
    assert err["status"] == "error"
    assert err["error"] == "sidecar blew up"
    assert err["steps"] == []
    assert err["usage"]["inputTokens"] == 0
