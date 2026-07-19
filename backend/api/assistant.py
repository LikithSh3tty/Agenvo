"""Vercel serverless entrypoint for the agenvo assistant.

Same-origin production counterpart of chatbot/server.py: POST /api/assistant
runs the LangGraph pipeline from chatbot/; GET returns a health payload.
"""
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler

# Make the chatbot package (graph.py, analytics.py, app_guide.md) importable.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "chatbot"))

# Reject payloads larger than this before reading them. Generous enough for a
# large data snapshot, small enough to stop memory/cost-exhaustion abuse.
MAX_BODY_BYTES = 2_000_000


class handler(BaseHTTPRequestHandler):
    def _send(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send({"status": "ok", "llm": bool(os.environ.get("ANTHROPIC_API_KEY"))})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send({"reply": "Bad request.", "route": "error"}, 400)
            return
        if length > MAX_BODY_BYTES:
            self._send({"reply": "Request too large.", "route": "error"}, 413)
            return
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send({"reply": "Bad request.", "route": "error"}, 400)
            return
        if not isinstance(req, dict):
            self._send({"reply": "Bad request.", "route": "error"}, 400)
            return
        if not os.environ.get("ANTHROPIC_API_KEY"):
            self._send({
                "reply": "The assistant isn't configured yet - the server is missing an Anthropic API key.",
                "route": "error",
            })
            return
        try:
            from graph import run_chat

            self._send(run_chat(
                str(req.get("message") or ""),
                req.get("history") or [],
                req.get("snapshot") or {},
            ))
        except Exception:
            traceback.print_exc()
            self._send({"reply": "Something went wrong on my end. Please try again.", "route": "error"})
