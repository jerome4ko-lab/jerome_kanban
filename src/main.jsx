import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

if (typeof window !== "undefined") {
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) => {
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
  });

  document
    .querySelectorAll(
      'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], script[src*="youtube.com/iframe_api"]',
    )
    .forEach((el) => {
      if (el instanceof HTMLIFrameElement) {
        el.src = "about:blank";
      }
      el.remove();
    });
  delete window.onYouTubeIframeAPIReady;

  if ("serviceWorker" in navigator) {
    let reloadingForServiceWorkerUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForServiceWorkerUpdate) return;
      reloadingForServiceWorkerUpdate = true;
      window.location.reload();
    });
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
