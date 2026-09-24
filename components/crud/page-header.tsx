import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border bg-surface p-4 shadow-card md:p-5 ${className ?? ""}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

const TONE = {
  in: { text: "text-success", chip: "bg-success/15 text-success" },
  out: { text: "text-money-out-text", chip: "bg-money-out/15 text-money-out-text" },
  neutral: { text: "", chip: "bg-surface-2 text-foreground/70" },
  accent: { text: "", chip: "bg-accent text-accent-foreground" },
} as const;

export function StatPill({ label, value, tone = "neutral", icon: Icon, hint }: { label: string; value: string; tone?: keyof typeof TONE; icon?: LucideIcon; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-surface px-4 py-3 shadow-card">
      {Icon && (
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE[tone].chip}`}>
          <Icon className="size-4.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-heading text-xl font-bold tabular ${TONE[tone].text}`}>{value}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
