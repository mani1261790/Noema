"use client";

import { useEffect, useState } from "react";

type ThemeMode = "system" | "light" | "dark";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
    localStorage.removeItem("noema-theme");
    return;
  }

  root.setAttribute("data-theme", mode);
  localStorage.setItem("noema-theme", mode);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = localStorage.getItem("noema-theme");
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      applyTheme(saved);
      return;
    }

    setMode("system");
    applyTheme("system");
  }, []);

  const updateMode = (next: ThemeMode) => {
    setMode(next);
    applyTheme(next);
  };

  return (
    <div className="fixed right-3 top-3 z-50 rounded-full glass-panel p-1">
      <div className="flex items-center gap-1 text-xs font-medium">
        <button
          className={`rounded-full px-3 py-1.5 transition ${mode === "light" ? "glass-button text-white" : "glass-button-ghost"}`}
          onClick={() => updateMode("light")}
          type="button"
        >
          Light
        </button>
        <button
          className={`rounded-full px-3 py-1.5 transition ${mode === "dark" ? "glass-button text-white" : "glass-button-ghost"}`}
          onClick={() => updateMode("dark")}
          type="button"
        >
          Dark
        </button>
        <button
          className={`rounded-full px-3 py-1.5 transition ${mode === "system" ? "glass-button text-white" : "glass-button-ghost"}`}
          onClick={() => updateMode("system")}
          type="button"
        >
          Auto
        </button>
      </div>
    </div>
  );
}
