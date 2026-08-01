from types import SimpleNamespace

from graph import _text, parse_route


def test_parse_valid_analytics():
    out = parse_route('{"route": "analytics", "metric": "top_clients"}')
    assert out == {"route": "analytics", "metric": "top_clients"}


def test_parse_json_with_surrounding_prose():
    out = parse_route('Sure! {"route": "navigation", "metric": null} done')
    assert out["route"] == "navigation"


def test_parse_garbage_falls_back_to_clarify():
    assert parse_route("not json at all")["route"] == "clarify"


def test_parse_unknown_route_falls_back_to_clarify():
    assert parse_route('{"route": "weather"}')["route"] == "clarify"


def test_parse_unknown_metric_defaults_to_summary():
    out = parse_route('{"route": "analytics", "metric": "made_up"}')
    assert out["metric"] == "revenue_summary"


def test_text_plain_string():
    assert _text(SimpleNamespace(content="hello")) == "hello"


def test_text_skips_thinking_blocks():
    reply = SimpleNamespace(content=[
        {"type": "thinking", "thinking": "", "signature": "abc"},
        {"type": "text", "text": "The answer."},
    ])
    assert _text(reply) == "The answer."


def test_text_joins_multiple_text_blocks():
    reply = SimpleNamespace(content=[
        {"type": "text", "text": "Part one."},
        {"type": "thinking", "thinking": "hmm"},
        {"type": "text", "text": "Part two."},
    ])
    assert _text(reply) == "Part one.\nPart two."


def test_sanitize_caps_message_length():
    from graph import _sanitize, MAX_MESSAGE_CHARS
    msg, _, _ = _sanitize("x" * 10000, [], {})
    assert len(msg) == MAX_MESSAGE_CHARS


def test_sanitize_bounds_and_normalizes_history():
    from graph import _sanitize
    hist = [{"role": "user", "content": "hi"}, "junk", {"role": "assistant", "content": "yo"}, {"role": "x", "content": "z"}]
    _, clean, _ = _sanitize("q", hist * 10, {})
    assert len(clean) <= 10
    assert all(t["role"] in ("user", "assistant") for t in clean)
    assert "junk" not in [t["content"] for t in clean]


def test_sanitize_non_dict_snapshot_becomes_empty():
    from graph import _sanitize
    _, _, snap = _sanitize("q", [], "not a dict")
    assert snap == {}


def test_sanitize_handles_none_inputs():
    from graph import _sanitize
    msg, clean, snap = _sanitize(None, None, None)
    assert msg == "" and clean == [] and snap == {}


def test_today_uses_client_date():
    from graph import today_of
    assert today_of({"today": "2026-07-31"}) == "2026-07-31"


def test_today_falls_back_when_missing_or_bogus():
    from datetime import datetime, timezone
    from graph import today_of
    server_today = datetime.now(timezone.utc).date().isoformat()
    for snap in ({}, None, {"today": "31/07/2026"}, {"today": 20260731}, {"today": "2026-13-45"}):
        assert today_of(snap) == server_today


def test_facts_always_carry_today():
    from graph import compute_facts, today_of
    snapshot = {"today": "2026-07-31", "records": [], "clients": [], "chatters": []}
    facts = {"today": today_of(snapshot), **compute_facts("best_day", snapshot)}
    assert facts["today"] == "2026-07-31"
    assert "top_days_ranked" in facts
