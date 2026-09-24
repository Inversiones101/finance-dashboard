"use client";

import { useCallback, useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "finanzas101-theme";
export type ThemePreference = "light" | "dark" | "system";

/**
 * Se inyecta en <head> antes de pintar para evitar el parpadeo claro→oscuro.
 * Mantener sincronizado con `resolve()` de abajo.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.dataset.theme=p;}catch(e){}})();`;

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // almacenamiento bloqueado (modo privado, etc.)
  }
  return "system";
}

function resolve(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return media().matches ? "dark" : "light";
  return pref;
}

function apply(pref: ThemePreference) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolve(pref) === "dark");
  root.dataset.theme = pref;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onMedia = () => {
    if (readPreference() === "system") apply("system");
  };
  media().addEventListener("change", onMedia);
  return () => {
    listeners.delete(cb);
    media().removeEventListener("change", onMedia);
  };
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  const resolved = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light" as const
  );

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignorar
    }
    apply(next);
  }, []);

  return { preference, resolved, setPreference };
}
