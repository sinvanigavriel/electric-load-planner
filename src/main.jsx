import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// beforeinstallprompt is captured HERE, before React mounts, and not inside a
// component. Chromium fires it as soon as the install criteria are met, which
// is regularly before the first render — a listener registered in a useEffect
// misses it entirely, and the install button then silently does nothing. This
// is the single most common way a custom install button breaks.
//
// The event is stashed on window and a plain DOM event announces the change,
// so App can subscribe without caring when it arrived.
window.__installPrompt = null;

const announce = () => window.dispatchEvent(new Event("installability-change"));

window.addEventListener("beforeinstallprompt", (e) => {
  // Suppress the browser's own mini-infobar so our card is the only promotion.
  e.preventDefault();
  window.__installPrompt = e;
  announce();
});

// Fires however the app got installed — our card, the address bar, the browser
// menu — so the promotion disappears even when we were not the trigger.
window.addEventListener("appinstalled", () => {
  window.__installPrompt = null;
  announce();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
