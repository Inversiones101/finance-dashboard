"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";

export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved as "light" | "dark"}
      position="bottom-right"
      toastOptions={{ classNames: { toast: "!rounded-2xl !border !bg-popover !text-popover-foreground !shadow-card" } }}
    />
  );
}
