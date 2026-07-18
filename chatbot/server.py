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
