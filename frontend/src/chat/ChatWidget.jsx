import React, { useEffect, useRef, useState } from "react";

// Floating in-app assistant. In dev it talks to the local uvicorn backend; in
// production it uses the same-origin Vercel function. VITE_CHATBOT_URL
// overrides with an external FastAPI host (routes live under {url}/chat).
const CHAT_URL = import.meta.env.VITE_CHATBOT_URL
  ? `${import.meta.env.VITE_CHATBOT_URL}/chat`
  : import.meta.env.DEV
    ? "http://localhost:8000/chat"
    : "/api/assistant";

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

  // Draggable: grab the launcher or the panel header to move the whole widget.
  // Position is stored as offsets from the bottom-right corner so the panel
  // keeps opening upward from the launcher; null = the default resting spot.
  const [pos, setPos] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("agencyx-chat-pos"));
      if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) return p;
    } catch { /* ignore */ }
    return null;
  });
  const rootRef = useRef(null);
  const draggedRef = useRef(false); // suppresses the click that follows a drag

  const clampPos = (right, bottom) => {
    const el = rootRef.current;
    const w = el ? el.offsetWidth : 52;
    const h = el ? el.offsetHeight : 52;
    return {
      right: Math.min(Math.max(8, right), Math.max(8, window.innerWidth - w - 8)),
      bottom: Math.min(Math.max(8, bottom), Math.max(8, window.innerHeight - h - 8)),
    };
  };

  const startDrag = (e) => {
    if (e.button !== 0 || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const orig = { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    let last = null;
    const onMove = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      last = clampPos(orig.right - dx, orig.bottom - dy);
      setPos(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      draggedRef.current = moved;
      if (moved && last) {
        try { localStorage.setItem("agencyx-chat-pos", JSON.stringify(last)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, busy]);

  // Opening the panel grows the widget upward; nudge it back on screen if the
  // saved spot would push the panel past the top edge.
  useEffect(() => {
    if (pos && rootRef.current) {
      const next = clampPos(pos.right, pos.bottom);
      if (next.right !== pos.right || next.bottom !== pos.bottom) setPos(next);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const res = await fetch(CHAT_URL, {
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
    <div ref={rootRef} className="no-print" style={{ position: "fixed", right: pos ? pos.right : 22, bottom: pos ? pos.bottom : 22, zIndex: 300, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
      {open && (
        <div style={{
          width: 360, height: 480, display: "flex", flexDirection: "column",
          background: "var(--card-bg)", border: "1px solid var(--card-border)",
          borderRadius: 18, overflow: "hidden", boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
        }}>
          <div onPointerDown={startDrag} title="Drag to move" style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "13px 16px", background: "var(--header-bg)", backdropFilter: "var(--blur)",
            borderBottom: "1px solid var(--card-border)",
            cursor: "grab", touchAction: "none", userSelect: "none",
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", fontFamily: "'Space Grotesk',sans-serif" }}>Assistant</div>
            <button onClick={() => setOpen(false)} onPointerDown={(e) => e.stopPropagation()} aria-label="Close assistant" style={{
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
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
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

      <button
        onPointerDown={startDrag}
        onClick={() => {
          if (draggedRef.current) { draggedRef.current = false; return; }
          setOpen((o) => !o);
        }}
        aria-label="Open assistant" title="Click to chat, drag to move" style={{
          width: 52, height: 52, borderRadius: 999, border: "1px solid var(--card-border)",
          background: open ? "var(--surface2)" : "var(--pop)", color: open ? "var(--ink)" : "var(--pop-fg)",
          cursor: "pointer", display: "grid", placeItems: "center", touchAction: "none",
          boxShadow: "0 10px 28px rgba(0,0,0,0.24)",
        }}><ChatIcon /></button>
    </div>
  );
}
