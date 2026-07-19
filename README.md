<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="frontend/public/brand/agenvo-white.png">
  <img src="frontend/public/brand/agenvo-black.png" alt="Agenvo" width="320">
</picture>

**Every sale split, booked, and invoiced — your agency's numbers, handled.**

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-12-FFCA28?logo=firebase&logoColor=black)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-0.2-1C3C3C?logo=langchain&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-Haiku%20%2B%20Sonnet-D97757?logo=anthropic&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white)

</div>

An income tracker for agencies. You log who paid you and who did the work, and it does the accounting — splitting every invoice into your agency fee and your team's pay, tracking it per client, per person, and per day, and rolling it all up into a dashboard. Sign in and your data is yours: it lives in your own Firestore document and nobody else can touch it.

It runs in two flavours from the same codebase. In **service-agency mode** you have clients, team members, and sales. In **solo/brand mode** you have brands, expense categories, and entries. You pick one during onboarding and can rename the terms — what you call "Clients", "Team Members", or "Sales" — to whatever fits how you actually talk about your business.

The part I had the most fun with is the built-in assistant, **AgenMate**. There's a floating chat window on every screen. Ask it "who's my top client?" or "how much was the agency cut on the 7th?" and it answers from your real numbers — not a guess, an actual figure computed in Python. Ask it where a feature lives and it walks you there. Ask it something it can't help with and it says so instead of making something up.

**Live:** [agenvox.vercel.app](https://agenvox.vercel.app)

## What it does

- **Splits every sale automatically** into the agency fee and the team payout, using per-client commission rules you set once. Handles multiple currencies with live exchange rates, so a client who pays in EUR still rolls into your USD totals correctly.
- **Shows the whole picture on one dashboard** — revenue, earnings, and team pay over time, with per-client and per-team-member breakdown cards and daily/weekly/monthly charts.
- **Builds invoices** from logged sales, ready to share or print, and keeps a full editable history of every record with CSV export.
- **Keeps each account isolated.** Auth is Firebase; data is a single per-user Firestore document locked down so you can only ever read and write your own. There's no shared table anyone could wander into.
- **Answers questions in plain English** through AgenMate, an in-app assistant that computes analytics deterministically and phrases them with Claude — grounded strictly in your data, so it never invents a number.
- **Adapts to your business** with two agency modes and fully renameable terminology, plus light (Daylight) and dark (Midnight) themes.

## How the assistant is wired

The chat backend is a LangGraph `StateGraph`. A message comes in, a fast model routes it, and then one of three nodes handles it. The trick that keeps it honest: **every number is calculated in Python first**, and the language model only ever phrases facts it's handed — it's never asked to do the math or recall the data itself.

```
                      message
                         │
                         ▼
                    ┌─────────┐
                    │ router  │   Claude Haiku picks a lane + metric
                    └────┬────┘
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐  ┌────────────┐  ┌──────────┐
   │ analytics  │  │ navigation │  │ clarify  │
   └──────┬─────┘  └──────┬─────┘  └────┬─────┘
          │               │             │
  numbers computed in     answered      "that's outside what
  Python; Sonnet just     only from     I cover — did you
  phrases the facts       app_guide.md  mean ...?"
          └───────────────┴─────────────┘
                          ▼
                        reply
```

- **Router** (Haiku) classifies the message as an analytics question, a navigation question, or out-of-scope — and for analytics, which metric it needs (top clients, best day, revenue by date, and so on).
- **Analytics** computes the exact figures from the data snapshot in `analytics.py`, then Claude Sonnet turns those figures into a natural sentence. If the data's empty, it says so rather than inventing anything.
- **Navigation** answers only from a hand-written app guide, so it can't hallucinate a feature that doesn't exist.
- **Clarify** catches greetings and anything off-topic and steers the conversation back.

The frontend sends a snapshot of your (already-loaded) data with each message, so the backend never needs its own copy of your Firestore document. In local dev the widget talks to a FastAPI server; in production it calls a same-origin Vercel Python function that runs the exact same graph.

## Project layout

```
agency/
├── frontend/
│   ├── src/
│   │   ├── tracker/          # the app, split by concern — App.jsx plus currency,
│   │   │                     #   config, theme, ui, charts, nav, invoice, settings,
│   │   │                     #   onboarding, management modules
│   │   ├── auth/             # Firebase auth + per-user Firestore storage
│   │   └── chat/
│   │       └── ChatWidget.jsx   # the floating assistant window
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── chatbot/                  # the assistant backend (shared by dev + prod)
│   ├── graph.py              # LangGraph router → analytics / navigation / clarify
│   ├── analytics.py          # deterministic metrics (all the number-crunching)
│   ├── app_guide.md          # the navigation knowledge base
│   ├── server.py             # FastAPI wrapper for local dev (uvicorn)
│   ├── requirements.txt
│   └── test_*.py             # unit tests for the analytics + router
├── backend/api/
│   ├── assistant.py          # Vercel Python function — /api/assistant (prod)
│   ├── rates.js              # same-origin FX-rate proxy (Node)
│   └── requirements.txt
├── firebase/                 # Firestore rules + indexes
├── vercel.json               # builds the SPA + both serverless functions
└── README.md
```

## Running it locally

You'll need Node 18+ and Python 3.11+.

### 1. Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite serves the app on `http://localhost:5173`. For local auth it falls back to a bundled Firebase config, so you can sign in and click around straight away. To point it at your own Firebase project, set the `VITE_FIREBASE_*` variables in a `.env` file.

### 2. Assistant backend

In a second terminal:

```bash
cd chatbot
pip install -r requirements.txt
```

Drop your key in `chatbot/.env`:

```
ANTHROPIC_API_KEY=your_key_here
```

Then start the API:

```bash
uvicorn server:app --port 8000
```

The chat widget will find it automatically. Without a key the widget still shows up — it just tells you the assistant isn't configured instead of guessing. The analytics tests run without a key at all:

```bash
python -m pytest -v
```

## The assistant API

**`POST /api/assistant`** (production) / **`POST /chat`** (local dev)

```json
{
  "message": "how much was the agency cut on the 7th?",
  "history": [],
  "snapshot": { "clients": [], "chatters": [], "records": [], "config": {} }
}
```

`history` is the running conversation (`{ "role": "user" | "assistant", "content": "..." }`), and `snapshot` is your data — the backend is stateless and holds nothing of its own. Response:

```json
{
  "reply": "On July 7th the agency's cut was 60.00 USD, out of 150.00 USD across 2 sales.",
  "route": "analytics"
}
```

**`GET /api/assistant`** returns `{ "status": "ok", "llm": true }` when a key is configured.

## A note on security

Because the assistant endpoint is public (browsers call it directly), it's hardened against abuse: request bodies are capped before they're read, message and history lengths are bounded, and list outputs are limited — so nobody can run up the API bill or exhaust memory with a giant payload. On the data side, Firestore rules enforce strict per-user isolation with a default-deny on everything else, all invoice/print output is HTML-escaped, and the FX proxy sanitizes its input. The assistant can only ever see the data the signed-in user sends, and every figure it reports is computed server-side rather than pulled from the model.

## Deployment

`vercel.json` builds the frontend as a static site and runs two serverless functions — the Node FX proxy and the Python assistant — with `/api/*` routed to the backend and everything else falling through to the SPA. Add `ANTHROPIC_API_KEY` (and any `VITE_FIREBASE_*` overrides) in the Vercel project settings and push; the assistant appears automatically once the key is set.

## Things I'd add next

- Let the assistant answer trend questions ("is revenue up this month?") by handing it period-over-period comparisons.
- Server-side rate limiting per user on the assistant, on top of the current size caps.
- A proper end-to-end test around the chat widget, not just the analytics functions.
- Export the whole workspace (clients, records, invoices) as a single downloadable backup.
