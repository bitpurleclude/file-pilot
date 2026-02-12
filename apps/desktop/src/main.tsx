import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./pages/app.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element missing");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
