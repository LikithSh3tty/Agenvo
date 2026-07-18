# agencyx Assistant Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-app assistant (Python FastAPI + LangGraph backend, floating React chat widget) that answers navigation and analytics questions over the user's agency data with zero hallucination.

**Architecture:** A LangGraph `StateGraph` with a Haiku router node dispatching to three nodes: analytics (Python computes numbers deterministically, Sonnet only phrases them), navigation (answers from a hand-written `app_guide.md`), and clarify (for out-of-scope questions). The React frontend sends `{message, history, snapshot}` per request; the snapshot is the user's already-loaded Firestore data.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, LangGraph, langchain-anthropic, pytest; React (Vite) frontend.

## Global Constraints

- Models: router + clarify use `claude-haiku-4-5`; analytics/navigation phrasing uses `claude-sonnet-5`. Both overridable via env vars `ROUTER_MODEL` / `ANSWER_MODEL`. (Approved in the design spec.)
- **Never pass `temperature`, `top_p`, or `top_k` to `ChatAnthropic`** — `claude-sonnet-5` rejects non-default sampling parameters with a 400.
- No emoji anywhere in the UI — line icons (inline SVG) only.
- Widget styling uses the app's existing CSS variables (`--card-bg`, `--card-border`, `--pop`, `--pop-fg`, `--surface`, `--surface2`, `--text-dim`, `--text-muted`, `--ink`, `--accent`, `--accent-fg`, `--header-bg`, `--blur`) so it follows light/dark automatically. Never hard-code theme colors.
- Git commits: plain messages, **no** `Co-Authored-By: Claude` trailer.
- Repo root for all paths below: `C:\Users\HP\Downloads\agencyx\agency`. Backend lives in `chatbot/`; run backend commands from that directory.
- `chatbot/.env` holds `ANTHROPIC_API_KEY` and must be git-ignored.

---

### Task 1: Backend scaffolding + deterministic analytics

**Files:**
- Create: `chatbot/requirements.txt`
- Create: `chatbot/.gitignore`
- Create: `chatbot/analytics.py`
- Test: `chatbot/test_analytics.py`

**Interfaces:**
- Consumes: nothing (pure functions over dicts).
- Produces (used by Task 3's graph):
  - `top_clients(snapshot: dict, n: int | None = None) -> list[dict]` — `[{"name", "total", "sales", "currency"}]` sorted by `total` desc, totals in base currency, rounded to 2 dp.
  - `top_team_members(snapshot, n=None) -> list[dict]` — same shape.
  - `top_days(snapshot, n=None) -> list[dict]` — `[{"date", "total", "sales", "currency"}]` sorted by `total` desc.
  - `revenue_summary(snapshot) -> dict` — `{"currency", "total", "agency_earnings", "team_pay", "sales_count", "client_count", "team_member_count"}`.
- Snapshot shape (built by the frontend in Task 4):
  ```json
  {
    "clients":  [{"id", "name", "currency", ...}],
    "chatters": [{"id", "name", "clientId", ...}],
    "records":  [{"id", "chatterId", "amount", "date", "agencyCut", "chatterCut", "currency"}],
    "config":   {"baseCurrency": "USD", "currencies": [{"code": "EUR", "rate": 1.08}]}
  }
  ```
  A record reaches its client through its chatter's `clientId`. `rate` = value of 1 unit in the base currency; base currency has implicit rate 1.

- [ ] **Step 1: Create scaffolding files**

`chatbot/requirements.txt`:
```
fastapi
uvicorn[standard]
langgraph
langchain-anthropic
python-dotenv
pytest
httpx
```

`chatbot/.gitignore`:
```
.env
__pycache__/
.venv/
```

- [ ] **Step 2: Install dependencies**

Run (from `chatbot/`): `pip install -r requirements.txt`
Expected: installs succeed. (If the machine uses `py`, substitute `py -m pip`.)

- [ ] **Step 3: Write the failing tests**

`chatbot/test_analytics.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `python -m pytest test_analytics.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'analytics'`

- [ ] **Step 5: Write `chatbot/analytics.py`**

```python
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest test_analytics.py -v`
Expected: all 11 tests PASS

- [ ] **Step 7: Commit**

```bash
git add chatbot/requirements.txt chatbot/.gitignore chatbot/analytics.py chatbot/test_analytics.py
git commit -m "Add chatbot backend scaffolding and deterministic analytics"
```

---

### Task 2: App guide + LangGraph router graph

**Files:**
- Create: `chatbot/app_guide.md`
- Create: `chatbot/graph.py`
- Test: `chatbot/test_graph.py`

**Interfaces:**
- Consumes: `analytics.top_clients/top_team_members/top_days/revenue_summary` (Task 1 signatures).
- Produces (used by Task 3's server):
  - `run_chat(message: str, history: list[dict], snapshot: dict) -> dict` returning `{"reply": str, "route": str}`. `history` items are `{"role": "user"|"assistant", "content": str}`.
  - `parse_route(text: str) -> dict` returning `{"route": "navigation"|"analytics"|"clarify", "metric": str|None}` (pure, unit-tested).

- [ ] **Step 1: Write `chatbot/app_guide.md`**

This is the navigation knowledge base. Before finalizing, skim `frontend/agency-tracker.jsx` for the current tab labels (service mode: Dashboard, Add Sales, Clients, Invoices, History; solo/brand mode: Dashboard, Add Entry, Brands, Categories, Invoices, History) and adjust wording if the UI differs. Content:

```markdown
# agencyx App Guide

agencyx is an agency income tracker. Data is saved automatically per signed-in
account. Depending on setup, the workspace runs in **service agency** mode
(clients + team members + sales) or **solo/brand** mode (brands + expense
categories + entries). Tab names below use the default terms; the user can
rename terms like "Clients", "Team Members", and "Sales" in Settings, so their
sidebar labels may differ.

## Navigation (sidebar)

The sidebar is the floating panel on the left. Click an item to switch tabs.
It can be collapsed with the collapse control at its bottom.

### Service agency mode tabs
- **Dashboard** — overview of revenue, agency earnings, team pay; charts with
  daily/weekly/monthly granularity; per-client and per-team-member breakdown
  cards; date filter.
- **Add Sales** — log sales for a chosen date. Pick the client, type amounts
  next to each team member, then save. Supports logging several team members
  at once, and a smart-paste tool that scans pasted text for names and amounts.
- **Clients** — add, edit, and delete clients. Per client: name, color,
  currency, agency fee share, and team pay share; extra payout roles can be
  configured while editing a client. Team members are added here under the
  client they work for.
- **Invoices** — build and view invoices from logged sales; invoices can be
  shared or printed.
- **History** — every logged sale in a table; edit or delete individual
  records; export data as CSV; undo the last delete.

### Solo / brand mode tabs
- **Dashboard** — revenue, spend, and profit overview with charts.
- **Add Entry** — log an entry for a brand and date: the brand payment (flat,
  hourly, or % of revenue) and expenses per category, with manual overrides.
- **Brands** — add/edit brands, each with a color and payment structure;
  retainer brands support a quick-log.
- **Categories** — expense categories with a color and a cost rule (percent or
  flat) used to pre-calculate spend in Add Entry.
- **Invoices** and **History** — same as service mode.

## Common actions
- **Switch theme** — the light/dark toggle sits in the top header bar. Light
  mode is "Daylight", dark mode is "Midnight".
- **Account menu** — top-right avatar: sign out, delete account, reset data.
- **Settings** — accessible from the header; covers business name and logo,
  base currency plus extra currencies (live exchange rates, editable by hand),
  and renaming terms (what you call clients, team members, sales).
- **Onboarding** — first sign-in runs a short setup wizard: agency type, name,
  currency, and default commission splits.

## What the assistant can answer
- Navigation questions: where to find a screen or action (from this guide).
- Analytics questions from the user's own data: top clients by revenue,
  best/top team members, best day, and overall revenue summary (total revenue,
  agency earnings, team pay, counts).

The assistant cannot: edit data, log sales, create invoices, or answer
questions unrelated to agencyx.
```

- [ ] **Step 2: Write the failing tests for `parse_route`**

`chatbot/test_graph.py`:
```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest test_graph.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'graph'`

- [ ] **Step 4: Write `chatbot/graph.py`**

```python
"""LangGraph router graph: router -> analytics | navigation | clarify.

The router and clarify nodes run on Haiku; answer phrasing runs on Sonnet.
Numbers are computed in analytics.py — the LLM is instructed to phrase only
the FACTS block, which is what makes analytics answers hallucination-free.
"""
import json
import os
from pathlib import Path
from typing import Optional, TypedDict

from langchain_anthropic import ChatAnthropic
from langgraph.graph import END, StateGraph

import analytics

ROUTER_MODEL = os.environ.get("ROUTER_MODEL", "claude-haiku-4-5")
ANSWER_MODEL = os.environ.get("ANSWER_MODEL", "claude-sonnet-5")

METRICS = {"top_clients", "top_team_members", "best_day", "revenue_summary"}

APP_GUIDE = (Path(__file__).parent / "app_guide.md").read_text(encoding="utf-8")

ROUTER_SYSTEM = """You route messages for the agencyx assistant. agencyx is an
agency income tracker (clients, team members, sales, invoices).

Classify the user's latest message, using the conversation for context, and
reply with ONLY a JSON object, no other text:
{"route": "navigation" | "analytics" | "clarify", "metric": <string or null>}

- "navigation": how to use or find something in the agencyx app.
- "analytics": a question about the user's own business numbers. Also set
  "metric" to exactly one of:
    "top_clients"      - best/top clients, client rankings, second top client
    "top_team_members" - best/top team members or chatters, rankings
    "best_day"         - best day, biggest day, day with most sales
    "revenue_summary"  - totals, earnings, team pay, counts, everything else
- "clarify": greetings, ambiguous messages, or anything unrelated to agencyx.

Follow-ups like "and the second one?" keep the route/metric of the question
they follow."""

ANALYTICS_SYSTEM = """You are the agencyx assistant. Answer the user's question
using ONLY the numbers in the FACTS block below. Rules:
- Never invent, estimate, or extrapolate a number. If the FACTS don't contain
  what's asked, say you don't have that data.
- If the data is empty, say there's no data logged yet and point them to the
  relevant tab (Add Sales) instead of making numbers up.
- Amounts are in the currency given in FACTS. Format amounts with the currency
  code, e.g. "1,250.00 USD".
- Be concise and friendly: one short paragraph, no headers, no emoji.

FACTS:
{facts}"""

NAVIGATION_SYSTEM = """You are the agencyx assistant. Answer the user's
question about using the agencyx app using ONLY the app guide below. If the
guide doesn't cover the question, say so and briefly list what you can help
with. Never invent screens, buttons, or features not in the guide. Be concise:
a couple of sentences, no headers, no emoji.

APP GUIDE:
{guide}"""

CLARIFY_SYSTEM = """You are the agencyx assistant, an in-app helper for an
agency income tracker. The user's message is either a greeting, ambiguous, or
outside your scope. Reply in one or two friendly sentences, no emoji:
- If it's a greeting, greet back and say what you can do.
- Otherwise, say you can only help with the agencyx app, and ask one short
  clarifying question. You can help with: navigating the app, and questions
  about their data (top clients, best team member, best day, revenue summary)."""


class ChatState(TypedDict, total=False):
    message: str
    history: list
    snapshot: dict
    route: str
    metric: Optional[str]
    facts: dict
    reply: str


def _llm(model):
    return ChatAnthropic(model=model, max_tokens=1024)


def _messages(system, history, message):
    msgs = [("system", system)]
    for turn in (history or [])[-10:]:
        role = "assistant" if turn.get("role") == "assistant" else "human"
        content = str(turn.get("content") or "")
        if content:
            msgs.append((role, content))
    msgs.append(("human", message))
    return msgs


def parse_route(text):
    """Best-effort JSON extraction from the router reply; clarify on failure."""
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        obj = json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        return {"route": "clarify", "metric": None}
    route = obj.get("route")
    if route not in ("navigation", "analytics", "clarify"):
        return {"route": "clarify", "metric": None}
    metric = obj.get("metric") if route == "analytics" else None
    if route == "analytics" and metric not in METRICS:
        metric = "revenue_summary"
    return {"route": route, "metric": metric}


def router_node(state: ChatState) -> ChatState:
    reply = _llm(ROUTER_MODEL).invoke(
        _messages(ROUTER_SYSTEM, state.get("history"), state["message"])
    )
    return {**state, **parse_route(reply.content if isinstance(reply.content, str) else str(reply.content))}


def compute_facts(metric, snapshot):
    if metric == "top_clients":
        return {"top_clients_ranked": analytics.top_clients(snapshot, 5)}
    if metric == "top_team_members":
        return {"top_team_members_ranked": analytics.top_team_members(snapshot, 5)}
    if metric == "best_day":
        return {"top_days_ranked": analytics.top_days(snapshot, 5)}
    return {"summary": analytics.revenue_summary(snapshot)}


def analytics_node(state: ChatState) -> ChatState:
    facts = compute_facts(state.get("metric"), state.get("snapshot") or {})
    system = ANALYTICS_SYSTEM.format(facts=json.dumps(facts, indent=2))
    reply = _llm(ANSWER_MODEL).invoke(
        _messages(system, state.get("history"), state["message"])
    )
    return {**state, "facts": facts, "reply": reply.content}


def navigation_node(state: ChatState) -> ChatState:
    system = NAVIGATION_SYSTEM.format(guide=APP_GUIDE)
    reply = _llm(ANSWER_MODEL).invoke(
        _messages(system, state.get("history"), state["message"])
    )
    return {**state, "reply": reply.content}


def clarify_node(state: ChatState) -> ChatState:
    reply = _llm(ROUTER_MODEL).invoke(
        _messages(CLARIFY_SYSTEM, state.get("history"), state["message"])
    )
    return {**state, "reply": reply.content}


def _build():
    g = StateGraph(ChatState)
    g.add_node("router", router_node)
    g.add_node("analytics", analytics_node)
    g.add_node("navigation", navigation_node)
    g.add_node("clarify", clarify_node)
    g.set_entry_point("router")
    g.add_conditional_edges(
        "router",
        lambda s: s["route"],
        {"analytics": "analytics", "navigation": "navigation", "clarify": "clarify"},
    )
    g.add_edge("analytics", END)
    g.add_edge("navigation", END)
    g.add_edge("clarify", END)
    return g.compile()


GRAPH = _build()


def run_chat(message, history, snapshot):
    out = GRAPH.invoke({"message": message, "history": history or [], "snapshot": snapshot or {}})
    return {"reply": out.get("reply") or "Sorry, I couldn't process that.", "route": out.get("route", "clarify")}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest test_graph.py test_analytics.py -v`
Expected: all tests PASS (importing `graph` must not require an API key — `ChatAnthropic` is only constructed inside node functions).

- [ ] **Step 6: Commit**

```bash
git add chatbot/app_guide.md chatbot/graph.py chatbot/test_graph.py
git commit -m "Add app guide and LangGraph router graph"
```

---

### Task 3: FastAPI server

**Files:**
- Create: `chatbot/server.py`
- Create: `chatbot/.env.example`
- Test: `chatbot/test_server.py`

**Interfaces:**
- Consumes: `graph.run_chat(message, history, snapshot) -> {"reply", "route"}`.
- Produces: `POST /chat` accepting `{"message": str, "history": list, "snapshot": dict}` and returning `{"reply": str, "route": str}` — the contract the Task 4 widget calls. `GET /health` returns `{"status": "ok", "llm": bool}`.

- [ ] **Step 1: Write the failing tests**

`chatbot/test_server.py`:
```python
from fastapi.testclient import TestClient

import server


def test_health():
    client = TestClient(server.app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_chat_happy_path(monkeypatch):
    monkeypatch.setattr(server, "run_chat", lambda m, h, s: {"reply": "hi", "route": "clarify"})
    monkeypatch.setattr(server, "HAS_KEY", True)
    client = TestClient(server.app)
    r = client.post("/chat", json={"message": "hello", "history": [], "snapshot": {}})
    assert r.status_code == 200
    assert r.json() == {"reply": "hi", "route": "clarify"}


def test_chat_without_api_key(monkeypatch):
    monkeypatch.setattr(server, "HAS_KEY", False)
    client = TestClient(server.app)
    r = client.post("/chat", json={"message": "hello"})
    assert r.status_code == 200
    assert "API key" in r.json()["reply"]


def test_chat_llm_error_is_friendly(monkeypatch):
    def boom(m, h, s):
        raise RuntimeError("anthropic exploded")
    monkeypatch.setattr(server, "run_chat", boom)
    monkeypatch.setattr(server, "HAS_KEY", True)
    client = TestClient(server.app)
    r = client.post("/chat", json={"message": "hello"})
    assert r.status_code == 200
    assert r.json()["route"] == "error"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_server.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'server'`

- [ ] **Step 3: Write `chatbot/server.py` and `.env.example`**

`chatbot/server.py`:
```python
"""FastAPI wrapper around the assistant graph. Run: uvicorn server:app --port 8000"""
import os

from dotenv import load_dotenv

load_dotenv()  # must run before importing graph so models pick up env overrides

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from graph import run_chat

HAS_KEY = bool(os.environ.get("ANTHROPIC_API_KEY"))

app = FastAPI(title="agencyx assistant")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list = []
    snapshot: dict = {}


@app.get("/health")
def health():
    return {"status": "ok", "llm": HAS_KEY}


@app.post("/chat")
def chat(req: ChatRequest):
    if not HAS_KEY:
        return {
            "reply": "The assistant isn't configured yet - the server is missing an Anthropic API key.",
            "route": "error",
        }
    try:
        return run_chat(req.message, req.history, req.snapshot)
    except Exception:
        return {"reply": "Something went wrong on my end. Please try again.", "route": "error"}


if not HAS_KEY:
    print("WARNING: ANTHROPIC_API_KEY not set - /chat will return a config error.")
```

`chatbot/.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-...
# Optional model overrides
# ROUTER_MODEL=claude-haiku-4-5
# ANSWER_MODEL=claude-sonnet-5
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_server.py -v`
Expected: 4 tests PASS

- [ ] **Step 5: Create the real `.env`**

Copy `.env.example` to `chatbot/.env` and ask the user to paste their real `ANTHROPIC_API_KEY` (do not commit `.env`; it is covered by `chatbot/.gitignore`).

- [ ] **Step 6: Commit**

```bash
git add chatbot/server.py chatbot/test_server.py chatbot/.env.example
git commit -m "Add FastAPI chat endpoint for the assistant"
```

---

### Task 4: React chat widget

**Files:**
- Create: `frontend/src/chat/ChatWidget.jsx`
- Modify: `frontend/agency-tracker.jsx` (two edits: import at top, mount at line ~4749)

**Interfaces:**
- Consumes: `POST {VITE_CHATBOT_URL||http://localhost:8000}/chat` with `{"message", "history", "snapshot"}` → `{"reply", "route"}` (Task 3 contract).
- Produces: `<ChatWidget data={data} config={config} />` — `data` is the App state `{clients, chatters, records, ...}`, `config` is the workspace config (has `locale.currency` and `currencies`).

- [ ] **Step 1: Write `frontend/src/chat/ChatWidget.jsx`**

```jsx
import React, { useEffect, useRef, useState } from "react";

// Floating in-app assistant. Talks to the local Python backend; hides itself
// in production builds when no backend URL is configured.
const BASE_URL = import.meta.env.VITE_CHATBOT_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

const ChatIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4 20-7z" />
  </svg>
);

const WELCOME = "Hi! Ask me how to use the app, or about your numbers - top clients, best team member, best day.";

export default function ChatWidget({ data, config }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([{ role: "assistant", content: WELCOME }]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, busy]);

  if (!BASE_URL) return null;

  const snapshot = () => ({
    clients: data.clients || [],
    chatters: data.chatters || [],
    records: data.records || [],
    config: {
      baseCurrency: (config?.locale?.currency || "USD").toUpperCase(),
      currencies: (config?.currencies || []).map((c) => ({ code: c.code, rate: c.rate })),
    },
  });

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = messages.slice(1); // drop the canned welcome from context
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history, snapshot: snapshot() }),
      });
      const json = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: json.reply || "Sorry, something went wrong." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "The assistant is offline right now. Start the chatbot server and try again." }]);
    }
    setBusy(false);
  };

  const bubble = (msg, i) => {
    const mine = msg.role === "user";
    return (
      <div key={i} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
        <div style={{
          maxWidth: "82%", padding: "9px 13px", borderRadius: 14, fontSize: 13.5, lineHeight: 1.45,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          background: mine ? "var(--pop)" : "var(--surface2)",
          color: mine ? "var(--pop-fg)" : "var(--ink)",
          border: mine ? "none" : "1px solid var(--card-border)",
          borderBottomRightRadius: mine ? 4 : 14,
          borderBottomLeftRadius: mine ? 14 : 4,
        }}>{msg.content}</div>
      </div>
    );
  };

  return (
    <div className="no-print" style={{ position: "fixed", right: 22, bottom: 22, zIndex: 300, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
      {open && (
        <div style={{
          width: 360, height: 480, display: "flex", flexDirection: "column",
          background: "var(--card-bg)", border: "1px solid var(--card-border)",
          borderRadius: 18, overflow: "hidden", boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "13px 16px", background: "var(--header-bg)", backdropFilter: "var(--blur)",
            borderBottom: "1px solid var(--card-border)",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", fontFamily: "'Space Grotesk',sans-serif" }}>Assistant</div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" style={{
              background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
              display: "grid", placeItems: "center", padding: 4,
            }}><CloseIcon /></button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map(bubble)}
            {busy && (
              <div style={{ display: "flex" }}>
                <div style={{ padding: "9px 13px", borderRadius: 14, background: "var(--surface2)", border: "1px solid var(--card-border)", color: "var(--text-muted)", fontSize: 13.5 }}>
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--card-border)" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask about the app or your numbers"
              style={{
                flex: 1, padding: "10px 12px", borderRadius: 12, fontSize: 13.5, outline: "none",
                background: "var(--field-bg)", border: "1px solid var(--field-border)", color: "var(--ink)",
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()} aria-label="Send" style={{
              width: 40, borderRadius: 12, border: "none", cursor: busy || !input.trim() ? "default" : "pointer",
              background: "var(--pop)", color: "var(--pop-fg)", display: "grid", placeItems: "center",
              opacity: busy || !input.trim() ? 0.5 : 1,
            }}><SendIcon /></button>
          </div>
        </div>
      )}

      <button onClick={() => setOpen((o) => !o)} aria-label="Open assistant" style={{
        width: 52, height: 52, borderRadius: 999, border: "1px solid var(--card-border)",
        background: open ? "var(--surface2)" : "var(--pop)", color: open ? "var(--ink)" : "var(--pop-fg)",
        cursor: "pointer", display: "grid", placeItems: "center",
        boxShadow: "0 10px 28px rgba(0,0,0,0.24)",
      }}><ChatIcon /></button>
    </div>
  );
}
```

Note: `--field-bg` / `--field-border` exist in the theme block (from `fieldBg`/`fieldBorder`); verify with a grep for `--field-bg` in `agency-tracker.jsx` and fall back to `var(--surface2)` / `var(--card-border)` if absent.

- [ ] **Step 2: Mount the widget in `frontend/agency-tracker.jsx`**

Edit 1 — add the import near the other imports at the top of the file:
```jsx
import ChatWidget from "./src/chat/ChatWidget.jsx";
```
(Verify the relative path: `agency-tracker.jsx` sits in `frontend/`, the widget in `frontend/src/chat/`, so `./src/chat/ChatWidget.jsx` is correct.)

Edit 2 — in `App()` (defined at ~line 2997), the return ends with:
```jsx
    </div >
    </ConfigContext.Provider>
```
Insert the widget between those two lines:
```jsx
    </div >
    <ChatWidget data={data} config={config} />
    </ConfigContext.Provider>
```
`data` and `config` are already in scope in `App()` (lines 2998–2999).

- [ ] **Step 3: Verify the frontend builds and renders**

Run (from `frontend/`): `npm run dev`
Expected: Vite starts without errors; the launcher button appears bottom-right on every tab; opening it shows the welcome message; theme toggle switches the panel's colors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/chat/ChatWidget.jsx frontend/agency-tracker.jsx
git commit -m "Add floating assistant chat widget"
```

---

### Task 5: End-to-end smoke test

**Files:** none created; verification only.

- [ ] **Step 1: Start both processes**

Terminal 1 (from `chatbot/`): `uvicorn server:app --port 8000`
Terminal 2 (from `frontend/`): `npm run dev`
Expected: server starts without the missing-key warning; frontend at http://localhost:5173.

- [ ] **Step 2: Exercise all four routes in the widget**

Sign in, make sure some clients/team members/sales exist (log a couple in Add Sales if empty), then ask:
1. Navigation: "where do I add a client?" → answer mentions the Clients tab.
2. Analytics: "who is my top client?" → names the actual top client with the correct total (cross-check against the Dashboard).
3. Follow-up: "and the second one?" → names the second-ranked client (router keeps analytics/top_clients from history).
4. Out-of-context: "what's the weather in Paris?" → clarify response listing what it can help with, no weather answer.

- [ ] **Step 3: Verify failure modes**

- Stop the uvicorn server, send a message → widget shows the "assistant is offline" notice, app doesn't crash.
- With an empty account (no records), ask "who is my top client?" → reply says no data yet, no invented numbers.

- [ ] **Step 4: Run the full backend test suite one last time**

Run (from `chatbot/`): `python -m pytest -v`
Expected: all tests PASS

- [ ] **Step 5: Commit any fixes and finish**

```bash
git add -A chatbot frontend
git commit -m "Assistant chatbot: smoke-test fixes"
```
(Skip if nothing changed.)
