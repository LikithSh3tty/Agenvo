from graph import parse_route


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
