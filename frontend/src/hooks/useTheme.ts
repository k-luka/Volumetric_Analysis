import { useEffect, useState } from "react";

function initialTheme(): "dark" | "light" {
  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== "function") {
      return "dark";
    }
    const stored = storage.getItem("volumetric-theme");
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function storeTheme(theme: "dark" | "light") {
  try {
    const storage = window.localStorage;
    if (storage && typeof storage.setItem === "function") {
      storage.setItem("volumetric-theme", theme);
    }
  } catch {
    // Theme persistence is optional; the UI still works when storage is unavailable.
  }
}

export function useTheme(): { theme: "dark" | "light"; toggleTheme: () => void } {
  const [theme, setTheme] = useState<"dark" | "light">(initialTheme);

  useEffect(() => {
    storeTheme(theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  return { theme, toggleTheme };
}
