import analytics

EMPTY = {"clients": [], "chatters": [], "records": [], "config": {"baseCurrency": "USD", "currencies": []}}


def snap(clients=(), chatters=(), records=(), currencies=(), base="USD"):
    return {
        "clients": list(clients),
        "chatters": list(chatters),
        "records": list(records),
        "config": {"baseCurrency": base, "currencies": list(currencies)},
    }


BASIC = snap(
    clients=[{"id": "c1", "name": "Acme"}, {"id": "c2", "name": "Globex"}],
    chatters=[
        {"id": "t1", "name": "Ana", "clientId": "c1"},
        {"id": "t2", "name": "Ben", "clientId": "c2"},
    ],
    records=[
        {"id": "r1", "chatterId": "t1", "amount": 100, "date": "2026-07-01", "agencyCut": 40, "chatterCut": 60, "currency": "USD"},
        {"id": "r2", "chatterId": "t1", "amount": 50, "date": "2026-07-02", "agencyCut": 20, "chatterCut": 30, "currency": "USD"},
        {"id": "r3", "chatterId": "t2", "amount": 120, "date": "2026-07-02", "agencyCut": 48, "chatterCut": 72, "currency": "USD"},
    ],
)


def test_top_clients_empty():
    assert analytics.top_clients(EMPTY) == []


def test_top_clients_ranked():
    ranked = analytics.top_clients(BASIC)
    assert [c["name"] for c in ranked] == ["Acme", "Globex"]
    assert ranked[0]["total"] == 150.0
    assert ranked[0]["sales"] == 2
    assert ranked[0]["currency"] == "USD"


def test_top_clients_limit():
    assert len(analytics.top_clients(BASIC, 1)) == 1


def test_top_clients_zero_limit():
    assert analytics.top_clients(BASIC, 0) == []


def test_top_clients_ignores_orphan_records():
    s = snap(
        clients=[{"id": "c1", "name": "Acme"}],
        chatters=[],
        records=[{"id": "r1", "chatterId": "ghost", "amount": 100, "date": "2026-07-01", "currency": "USD"}],
    )
    assert analytics.top_clients(s) == []


def test_top_team_members():
    ranked = analytics.top_team_members(BASIC)
    assert [t["name"] for t in ranked] == ["Ana", "Ben"]
    assert ranked[0]["total"] == 150.0


def test_top_days():
    ranked = analytics.top_days(BASIC)
    assert ranked[0]["date"] == "2026-07-02"   # 50 + 120 = 170
    assert ranked[0]["total"] == 170.0
    assert ranked[1]["date"] == "2026-07-01"


def test_currency_conversion():
    s = snap(
        clients=[{"id": "c1", "name": "Acme"}, {"id": "c2", "name": "Euro Co"}],
        chatters=[
            {"id": "t1", "name": "Ana", "clientId": "c1"},
            {"id": "t2", "name": "Ben", "clientId": "c2"},
        ],
        records=[
            {"id": "r1", "chatterId": "t1", "amount": 100, "date": "2026-07-01", "currency": "USD"},
            {"id": "r2", "chatterId": "t2", "amount": 100, "date": "2026-07-01", "currency": "EUR"},
        ],
        currencies=[{"code": "EUR", "rate": 1.1}],
    )
    ranked = analytics.top_clients(s)
    assert ranked[0]["name"] == "Euro Co"
    assert ranked[0]["total"] == 110.0


def test_unknown_currency_treated_as_base():
    s = snap(
        clients=[{"id": "c1", "name": "Acme"}],
        chatters=[{"id": "t1", "name": "Ana", "clientId": "c1"}],
        records=[{"id": "r1", "chatterId": "t1", "amount": 100, "date": "2026-07-01", "currency": "XYZ"}],
    )
    assert analytics.top_clients(s)[0]["total"] == 100.0


def test_revenue_summary():
    s = analytics.revenue_summary(BASIC)
    assert s["total"] == 270.0
    assert s["agency_earnings"] == 108.0
    assert s["team_pay"] == 162.0
    assert s["sales_count"] == 3
    assert s["client_count"] == 2
    assert s["team_member_count"] == 2


def test_revenue_summary_empty():
    s = analytics.revenue_summary(EMPTY)
    assert s["total"] == 0.0
    assert s["sales_count"] == 0


def test_client_list_includes_zero_sale_clients():
    s = snap(
        clients=[{"id": "c1", "name": "Acme"}, {"id": "c2", "name": "NewCo"}],
        chatters=[{"id": "t1", "name": "Ana", "clientId": "c1"}],
        records=[],
    )
    out = analytics.client_list(s)
    assert [c["name"] for c in out] == ["Acme", "NewCo"]
    assert out[0]["team_members"] == ["Ana"]
    assert out[1]["team_members"] == []


def test_client_list_empty():
    assert analytics.client_list(EMPTY) == []


def test_team_member_list():
    out = analytics.team_member_list(BASIC)
    assert out == [
        {"name": "Ana", "client": "Acme"},
        {"name": "Ben", "client": "Globex"},
    ]


def test_client_list_capped():
    from analytics import MAX_LIST_ITEMS
    s = snap(clients=[{"id": f"c{i}", "name": f"C{i}"} for i in range(MAX_LIST_ITEMS + 50)])
    assert len(analytics.client_list(s)) == MAX_LIST_ITEMS
