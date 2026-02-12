import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./pages/app.js";
import "./styles.css";

const reportClientError = async (payload: { code: string; message: string; details?: Record<string, unknown> }) => {
  if (window.filePilotApi === undefined) {
    return;
  }

  await window.filePilotApi.reportClientError(payload);
};

window.addEventListener("error", (event) => {
  void reportClientError({
    code: "RENDERER_UNCAUGHT_ERROR",
    message: event.message || "Renderer uncaught error",
    details: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    }
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  void reportClientError({
    code: "RENDERER_UNHANDLED_REJECTION",
    message: reason
  });
});

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element missing");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
