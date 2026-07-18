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

METRICS = {"top_clients", "top_team_members", "best_day", "revenue_summary", "list_clients", "list_team_members"}

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
    "list_clients"     - list/show/name all their clients
    "list_team_members" - list/show/name all their team members or chatters
    "revenue_summary"  - totals, earnings, team pay, counts, everything else
- "clarify": greetings, ambiguous messages, or anything unrelated to agencyx.

Follow-ups like "and the second one?" keep the route/metric of the question
they follow."""

TONE = """Voice: you're a sharp, friendly teammate who knows this app inside
out - not a manual and not a corporate bot. Use contractions. Answer the exact
question first in plain words, then stop; don't dump every related feature.
Vary your openers - never start with "Sure!" or "Great question". No headers,
no bullet lists unless the user asks for a list, no emoji.
Example of the vibe: "Acme's your top client - 1,250.00 USD across 4 sales.
Globex is next at 900.00." rather than the stiffer "Your top client is Acme,
with a total of 1,250.00 USD from 4 sales logged so far."
"""

ANALYTICS_SYSTEM = """You are the agencyx assistant. Answer the user's question
using ONLY the numbers in the FACTS block below. Rules:
- Never invent, estimate, or extrapolate a number. If the FACTS don't contain
  what's asked, say you don't have that data.
- If the data is empty, say there's nothing logged yet and casually point them
  to the Add Sales tab instead of making numbers up.
- Amounts are in the currency given in FACTS. Format amounts with the currency
  code, e.g. "1,250.00 USD".

""" + TONE + """

FACTS:
{facts}"""

NAVIGATION_SYSTEM = """You are the agencyx assistant. Answer the user's
question about using the agencyx app using ONLY the app guide below. If the
guide doesn't cover the question, say so honestly and mention what you can
help with. Never invent screens, buttons, or features not in the guide.
Answer like you'd tell a colleague where something is - just the part they
asked about, in a sentence or two.

""" + TONE + """

APP GUIDE:
{guide}"""

CLARIFY_SYSTEM = """You are the agencyx assistant, an in-app helper for an
agency income tracker. The user's message is either a greeting, ambiguous, or
outside your scope. Reply in one or two warm, natural sentences (contractions
welcome, no emoji):
- If it's a greeting, greet back like a person would and mention what you can
  help with.
- Otherwise, gently say that's outside what you cover and ask one short
  question to steer back. You can help with: finding things in the app, and
  their numbers (top clients, best team member, best day, revenue summary)."""


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


def _text(reply):
    """Plain text from an AIMessage. Adaptive-thinking models return a list of
    content blocks (thinking + text); keep only the text blocks."""
    content = reply.content
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "\n".join(p for p in parts if p).strip()


def router_node(state: ChatState) -> ChatState:
    reply = _llm(ROUTER_MODEL).invoke(
        _messages(ROUTER_SYSTEM, state.get("history"), state["message"])
    )
    return {**state, **parse_route(_text(reply))}


def compute_facts(metric, snapshot):
    if metric == "top_clients":
        return {"top_clients_ranked": analytics.top_clients(snapshot, 5)}
    if metric == "top_team_members":
        return {"top_team_members_ranked": analytics.top_team_members(snapshot, 5)}
    if metric == "best_day":
        return {"top_days_ranked": analytics.top_days(snapshot, 5)}
    if metric == "list_clients":
        return {"all_clients": analytics.client_list(snapshot)}
    if metric == "list_team_members":
        return {"all_team_members": analytics.team_member_list(snapshot)}
    return {"summary": analytics.revenue_summary(snapshot)}


def analytics_node(state: ChatState) -> ChatState:
    facts = compute_facts(state.get("metric"), state.get("snapshot") or {})
    system = ANALYTICS_SYSTEM.format(facts=json.dumps(facts, indent=2))
    reply = _llm(ANSWER_MODEL).invoke(
        _messages(system, state.get("history"), state["message"])
    )
    return {**state, "facts": facts, "reply": _text(reply)}


def navigation_node(state: ChatState) -> ChatState:
    system = NAVIGATION_SYSTEM.format(guide=APP_GUIDE)
    reply = _llm(ANSWER_MODEL).invoke(
        _messages(system, state.get("history"), state["message"])
    )
    return {**state, "reply": _text(reply)}


def clarify_node(state: ChatState) -> ChatState:
    reply = _llm(ROUTER_MODEL).invoke(
        _messages(CLARIFY_SYSTEM, state.get("history"), state["message"])
    )
    return {**state, "reply": _text(reply)}


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


# Defensive caps. The endpoint is public and unauthenticated, so these bound
# token cost and memory per request. They're far above any legitimate chat use,
# so they never alter behavior for real questions.
MAX_MESSAGE_CHARS = 4000
MAX_HISTORY_TURNS = 10
MAX_TURN_CHARS = 4000


def _sanitize(message, history, snapshot):
    """Coerce and bound untrusted request inputs without changing real-use behavior."""
    msg = str(message or "")[:MAX_MESSAGE_CHARS]
    clean_history = []
    if isinstance(history, list):
        for turn in history[-MAX_HISTORY_TURNS:]:
            if not isinstance(turn, dict):
                continue
            role = "assistant" if turn.get("role") == "assistant" else "user"
            content = str(turn.get("content") or "")[:MAX_TURN_CHARS]
            if content:
                clean_history.append({"role": role, "content": content})
    snap = snapshot if isinstance(snapshot, dict) else {}
    return msg, clean_history, snap


def run_chat(message, history, snapshot):
    message, history, snapshot = _sanitize(message, history, snapshot)
    out = GRAPH.invoke({"message": message, "history": history, "snapshot": snapshot})
    return {"reply": out.get("reply") or "Sorry, I couldn't process that.", "route": out.get("route", "clarify")}
