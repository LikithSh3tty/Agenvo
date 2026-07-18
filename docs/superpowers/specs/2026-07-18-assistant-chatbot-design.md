# agencyx Assistant — Chatbot Design

Date: 2026-07-18
Status: Approved

## Goal

An in-app assistant that answers two kinds of questions with zero hallucination:

1. **Navigation** — "where do I add a client?", "how do I log sales?" — answered from a hand-written app guide.
2. **Analytics** — "who is my top client?", "second top client?", "best team member?", "best day?" — answered from numbers computed deterministically in Python from the user's own data.

Anything outside those two scopes goes to a **clarify** node that asks a follow-up and states what the assistant can do.

## Decisions made during brainstorming

- **LangGraph (Python), not LangChain-only** — explicit router graph, per user correction.
- **Backend: Python FastAPI server** — separate `chatbot/` service, like the CloudNest support router pattern. Runs locally alongside `vite dev`; deployed Vercel app hides the widget when no backend URL is configured.
- **No embeddings** — the router is a single Claude classification call; the LLM handles paraphrases and word variants. (Anthropic has no embeddings API; user chose LLM-only routing over Voyage/local models.)
- **Data access: frontend sends snapshot** — the React app already holds the full dataset; each chat request carries it. No Firebase Admin SDK or service account on the server.
- **UI: floating widget** — bottom-right launcher, overlay panel, available on every tab.

## Architecture

```
POST /chat { message, history, snapshot }
        │
        ▼
   router node ── Claude Haiku classifies:
        │         route ∈ {navigation, analytics, clarify}
        │         metric ∈ {top_clients, best_team_member, best_day,
        │                   revenue_summary, ...} (analytics only)
        │
  ┌─────┼──────────────┐
  ▼     ▼              ▼
navigation  analytics   clarify
```

- **Router node** — Claude Haiku, JSON-only output. Receives the message plus recent history so follow-ups ("and the second one?") resolve against context.
- **Analytics node** — pure Python computes facts from the snapshot; Claude Sonnet phrases *only* those facts ("answer using only the FACTS block; if a fact is missing, say you don't have that data"). Empty dataset → honest "no data yet" reply, no invented numbers.
- **Navigation node** — Claude answers with `app_guide.md` injected as context; prompt forbids going beyond the guide.
- **Clarify node** — one clarifying question + a short list of what the assistant can help with. The user's follow-up re-enters the router with history.

## Data model (from `agency-tracker.jsx`)

Snapshot shape: `{ clients, chatters, records, brands, entries, invoices }`.

- `record`: `{ id, chatterId, amount, date, agencyCut, chatterCut, currency }`
- `chatter`: `{ id, name, clientId, roleId? }` — team member, belongs to a client
- `client`: `{ id, name, color, currency, agencyCut, chatterCut, ... }`

Revenue per client = sum of records whose chatter belongs to that client. Amounts carry the client's currency; metrics convert to the base currency using the rates in the snapshot config when mixed currencies exist.

## Components

### Backend — `agency/chatbot/`

| File | Purpose |
|---|---|
| `server.py` | FastAPI app, CORS for Vite dev origin, `POST /chat` |
| `graph.py` | LangGraph `StateGraph`; state `{messages, snapshot, route, metric, facts, reply}` |
| `analytics.py` | Deterministic metrics: `top_clients(data, n)`, `best_team_member(data)`, `best_day(data)`, `revenue_summary(data)` — currency-aware |
| `app_guide.md` | Hand-written navigation knowledge base covering every tab and action |
| `requirements.txt` | fastapi, uvicorn, langgraph, langchain-anthropic, python-dotenv |
| `.env` | `ANTHROPIC_API_KEY` (git-ignored) |

Models: Haiku for routing, Sonnet for phrasing; both configurable via env.

### Frontend — `frontend/src/chat/ChatWidget.jsx`

- Bottom-right launcher button (line icon, no emoji) → rounded floating panel.
- Theme-matched: existing card/border/radius tokens, accent `#F35627` (light) / lime `#EDF973` with dark text (dark), same font stack, respects the app's theme state.
- Messages list, input, typing indicator.
- Sends `{ message, history, snapshot }` from the already-loaded app data.
- Backend unreachable → quiet inline "assistant is offline" notice; never crashes the app.
- Backend URL from `VITE_CHATBOT_URL` (default `http://localhost:8000`); widget hidden when unset in production builds.

## Error handling

- Missing/invalid `ANTHROPIC_API_KEY` → server logs clearly at startup; `/chat` returns a friendly error the widget displays.
- Anthropic API error → "something went wrong, try again" reply, HTTP 200 so the widget stays usable.
- Malformed router JSON → fall back to clarify route.

## Testing

- Unit tests for every `analytics.py` function: empty data, single record, ties, mixed currencies. These are the no-hallucination core.
- Manual smoke test of all four paths: navigation question, analytics question, follow-up ("who's second?"), out-of-context question ("what's the weather?").

## Out of scope

- Deploying the Python backend (Render/Railway) — later.
- Streaming responses.
- Brands/entries (solo-creator mode) analytics beyond what `revenue_summary` naturally covers — the initial metric set targets the service-agency model (clients/chatters/records).
