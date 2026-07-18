"""Deterministic metrics over the agencyx data snapshot.

All money math happens here in Python; the LLM only phrases the results.
Amounts convert to the workspace base currency using the per-code rates the
frontend sends (rate = value of 1 unit in the base currency).
"""


def _rates(snapshot):
    cfg = snapshot.get("config") or {}
    base = str(cfg.get("baseCurrency") or "USD").upper()
    rates = {}
    for c in cfg.get("currencies") or []:
        code = str(c.get("code") or "").upper()
        rate = c.get("rate")
        if code and isinstance(rate, (int, float)) and rate > 0:
            rates[code] = float(rate)
    rates[base] = 1.0  # base always wins, even if listed with another rate
    return base, rates


def _to_base(amount, currency, rates):
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return 0.0
    return amt * rates.get(str(currency or "").upper(), 1.0)


def _rows(snapshot):
    """Yield (record, chatter, client); records reach clients via their chatter."""
    chatters = {c.get("id"): c for c in snapshot.get("chatters") or []}
    clients = {c.get("id"): c for c in snapshot.get("clients") or []}
    for r in snapshot.get("records") or []:
        chatter = chatters.get(r.get("chatterId"))
        client = clients.get(chatter.get("clientId")) if chatter else None
        yield r, chatter, client


def _ranked(buckets, base, n):
    ranked = sorted(buckets.values(), key=lambda e: e["total"], reverse=True)
    for e in ranked:
        e["total"] = round(e["total"], 2)
        e["currency"] = base
    return ranked[:n] if n else ranked


def top_clients(snapshot, n=None):
    base, rates = _rates(snapshot)
    buckets = {}
    for r, chatter, client in _rows(snapshot):
        if client is None:
            continue
        e = buckets.setdefault(client.get("id"), {"name": client.get("name") or "Unnamed", "total": 0.0, "sales": 0})
        e["total"] += _to_base(r.get("amount"), r.get("currency"), rates)
        e["sales"] += 1
    return _ranked(buckets, base, n)


def top_team_members(snapshot, n=None):
    base, rates = _rates(snapshot)
    buckets = {}
    for r, chatter, client in _rows(snapshot):
        if chatter is None:
            continue
        e = buckets.setdefault(chatter.get("id"), {"name": chatter.get("name") or "Unnamed", "total": 0.0, "sales": 0})
        e["total"] += _to_base(r.get("amount"), r.get("currency"), rates)
        e["sales"] += 1
    return _ranked(buckets, base, n)


def top_days(snapshot, n=None):
    base, rates = _rates(snapshot)
    buckets = {}
    for r, chatter, client in _rows(snapshot):
        date = r.get("date") or "unknown"
        e = buckets.setdefault(date, {"date": date, "total": 0.0, "sales": 0})
        e["total"] += _to_base(r.get("amount"), r.get("currency"), rates)
        e["sales"] += 1
    return _ranked(buckets, base, n)


def revenue_summary(snapshot):
    base, rates = _rates(snapshot)
    total = agency = team = 0.0
    count = 0
    for r, chatter, client in _rows(snapshot):
        total += _to_base(r.get("amount"), r.get("currency"), rates)
        agency += _to_base(r.get("agencyCut"), r.get("currency"), rates)
        team += _to_base(r.get("chatterCut"), r.get("currency"), rates)
        count += 1
    return {
        "currency": base,
        "total": round(total, 2),
        "agency_earnings": round(agency, 2),
        "team_pay": round(team, 2),
        "sales_count": count,
        "client_count": len(snapshot.get("clients") or []),
        "team_member_count": len(snapshot.get("chatters") or []),
    }
