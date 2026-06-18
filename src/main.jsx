import React from "react";
import ReactDOM from "react-dom/client";
import App from "../agency-tracker.jsx";

// Polyfill the window.storage API expected by the app.
if (!window.storage) {
  window.storage = {
    async get(key) {
      return { value: localStorage.getItem(key) };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
    },
  };
}

// Quick visual sanity check: ensure the script runs by changing the background briefly
if (typeof document !== "undefined") {
  document.body.style.background = "#111";

  // Show runtime errors in the page to help debugging when the app fails to render.
  window.addEventListener("error", (event) => {
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML = `<div style="padding:20px; font-family:system-ui, sans-serif; color:#fafafa; background:#111;">
        <h2 style=\"color:#ff7f7f;\">App failed to render</h2>
        <pre style=\"color:#ffdede; white-space: pre-wrap;\">${event.error?.stack || event.message}</pre>
      </div>`;
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
