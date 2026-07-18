import React from "react";
import ReactDOM from "react-dom/client";
import App from "../agency-tracker.jsx";
import { AuthProvider } from "./auth/AuthContext.jsx";
import AuthGate from "./auth/AuthGate.jsx";
import { makeGuestStorage } from "./auth/userStorage.js";

// The app talks to window.storage. Before login it's a guest store (pristine,
// non-persistent, theme only); installUserStorage() swaps in the per-user
// Firestore-backed store once someone signs in.
if (!window.storage) {
  window.storage = makeGuestStorage();
}

if (typeof document !== "undefined") {
  document.body.style.background = "#FAFAFA";

  // Show runtime errors in the page to help debugging when the app fails to
  // render. Build the DOM with textContent (never innerHTML) so an error
  // message can't inject markup.
  window.addEventListener("error", (event) => {
    const root = document.getElementById("root");
    if (root) {
      root.replaceChildren();
      const wrap = document.createElement("div");
      wrap.style.cssText = "padding:20px; font-family:system-ui, sans-serif; color:#fafafa; background:#111;";
      const h = document.createElement("h2");
      h.style.color = "#ff7f7f";
      h.textContent = "App failed to render";
      const pre = document.createElement("pre");
      pre.style.cssText = "color:#ffdede; white-space: pre-wrap;";
      pre.textContent = event.error?.stack || event.message || "Unknown error";
      wrap.append(h, pre);
      root.append(wrap);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <AuthGate>
      <App />
    </AuthGate>
  </AuthProvider>
);
