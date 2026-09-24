"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

export function ThemeToggle({ className, vertical }: { className?: string; vertical?: boolean }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn("inline-flex items-center gap-0.5 rounded-full border bg-surface-2 p-0.5", vertical && "flex-col", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setPreference(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-all",
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active && "bg-surface text-foreground shadow-card"
            )}
          >
            <Icon className={cn("size-3.5 transition-transform", active && "scale-110")} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
