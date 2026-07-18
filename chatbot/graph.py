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


def _text(reply):
    return reply.content if isinstance(reply.content, str) else str(reply.content)


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


def run_chat(message, history, snapshot):
    out = GRAPH.invoke({"message": message, "history": history or [], "snapshot": snapshot or {}})
    return {"reply": out.get("reply") or "Sorry, I couldn't process that.", "route": out.get("route", "clarify")}
