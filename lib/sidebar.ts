"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "i101-sidebar-collapsed";
const listeners = new Set<() => void>();

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Preferencia por navegador: barra lateral solo con íconos o con texto. */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => false
  );
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(KEY, read() ? "0" : "1");
    } catch {
      // almacenamiento bloqueado: el cambio dura solo esta visita
    }
    listeners.forEach((l) => l());
  }, []);
  return { collapsed, toggle };
}
