import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  dot,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "flat";
  /** Color semántico del dinero (--money-*) para identificar ingreso/gasto de un vistazo. */
  dot?: string;
}) {
  return (
    <div className="group flex flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-card transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
          {label}
        </span>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg bg-surface-2 text-foreground/70 transition-colors",
            "group-hover:bg-accent group-hover:text-accent-foreground"
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="font-heading text-2xl font-bold tabular">{value}</p>
      {hint && (
        <p
          className={cn(
            "text-xs",
            trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted-foreground"
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
