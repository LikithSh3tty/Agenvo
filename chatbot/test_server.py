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
