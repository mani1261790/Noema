import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@noema/ui/styles";
import "@noema/ui/article-styles";
import "./studio.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
