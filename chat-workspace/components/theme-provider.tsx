"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { applyMoteTheme, MOTE_MODE, MOTE_THEME_KEY } from "@/lib/mote";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: "dark", toggleTheme: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const active = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(active);
    if (!MOTE_MODE) return;
    const sync = () => {
      applyMoteTheme();
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === MOTE_THEME_KEY) sync();
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("storage", onStorage);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      media.removeEventListener("change", sync);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("sub2chat:theme", next);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
