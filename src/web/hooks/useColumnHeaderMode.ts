import { useEffect, useState } from "react";

export type ColumnHeaderMode = "friendly" | "database";

const STORAGE_KEY = "jax-mabl-column-header-mode";

function readInitialMode(): ColumnHeaderMode {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "database" ? "database" : "friendly";
}

export function useColumnHeaderMode() {
  const [mode, setMode] = useState<ColumnHeaderMode>(readInitialMode);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  function toggleMode() {
    setMode((current) => (current === "friendly" ? "database" : "friendly"));
  }

  return { mode, toggleMode };
}
