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
