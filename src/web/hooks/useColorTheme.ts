import { useEffect, useState } from "react";

export type ColorTheme = "light" | "dark";
type StoredColorTheme = ColorTheme | null;

const STORAGE_KEY = "jax-mabl-color-theme";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ColorTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

function readStoredTheme(): StoredColorTheme {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" ? storedTheme : null;
}

function readInitialTheme(): ColorTheme {
  return readStoredTheme() ?? systemTheme();
}

function applyTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function useColorTheme() {
  const [theme, setTheme] = useState<ColorTheme>(readInitialTheme);
  const [storedTheme, setStoredTheme] = useState<StoredColorTheme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (storedTheme) {
      window.localStorage.setItem(STORAGE_KEY, storedTheme);
      setTheme(storedTheme);
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
    setTheme(systemTheme());
  }, [storedTheme]);

  useEffect(() => {
    if (storedTheme) {
      return;
    }

    const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
    const updateSystemTheme = () => setTheme(mediaQuery.matches ? "dark" : "light");
    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, [storedTheme]);

  function setThemePreference(nextTheme: ColorTheme) {
    setStoredTheme(nextTheme);
  }

  function toggleTheme() {
    setThemePreference(theme === "dark" ? "light" : "dark");
  }

  return { theme, setTheme: setThemePreference, toggleTheme };
}
