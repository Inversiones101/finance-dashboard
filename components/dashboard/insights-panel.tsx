"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertOctagon, ChevronDown, ChevronRight, Info, Lightbulb, PartyPopper, TriangleAlert } from "lucide-react";
import type { Insight } from "@/lib/finance/engine";
import type { DashboardPrefs } from "@/lib/dashboard-widgets";
import { saveDashboardPrefsAction } from "@/lib/actions/profile";
import { cn } from "@/lib/utils";

const STYLE = {
  urgent: { icon: AlertOctagon, chip: "bg-danger/15 text-danger", label: "Urgente" },
  warning: { icon: TriangleAlert, chip: "bg-warning/15 text-warning", label: "Atención" },
  info: { icon: Info, chip: "bg-highlight/10 text-foreground", label: "Para saber" },
  tip: { icon: Lightbulb, chip: "bg-accent text-accent-foreground", label: "Sugerencia" },
} as const;

/** Alertas, advertencias de métricas y sugerencias. Se puede plegar; la preferencia se guarda. */
export function InsightsPanel({ insights, prefs }: { insights: Insight[]; prefs: DashboardPrefs }) {
  const [collapsed, setCollapsed] = useState(!!prefs.alertsCollapsed);
  const [, start] = useTransition();
  const counts = (["urgent", "warning", "info", "tip"] as const).map((k) => [k, insights.filter((i) => i.severity === k).length] as const).filter(([, n]) => n > 0);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    start(() => {
      void saveDashboardPrefsAction({ ...prefs, alertsCollapsed: next });
    });
  }

  return (
    <section className={cn("rounded-3xl border bg-surface p-5 shadow-card md:p-6", !collapsed && "h-full")}>
      <button type="button" onClick={toggle} aria-expanded={!collapsed} className="flex w-full items-center justify-between gap-2 text-left">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {collapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
          Alertas
        </h2>
        <span className="flex gap-1.5">
          {counts.map(([k, n]) => {
            const Icon = STYLE[k].icon;
            return (
              <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STYLE[k].chip)} title={STYLE[k].label}>
                <Icon className="size-3" /> {n}
              </span>
            );
          })}
        </span>
      </button>
      {!collapsed &&
        (insights.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
            <PartyPopper className="size-4" /> Todo en orden por ahora.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {insights.slice(0, 10).map((i) => {
              const st = STYLE[i.severity];
              const Icon = st.icon;
              const body = (
                <>
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl", st.chip)} title={st.label}>
                    <Icon className="size-4" aria-label={st.label} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.title}</span>
                    <span className="block text-xs text-muted-foreground">{i.detail}</span>
                  </span>
                  {i.href && <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />}
                </>
              );
              return (
                <li key={i.title}>
                  {i.href ? (
                    <Link href={i.href} className="flex items-start gap-3 rounded-2xl border px-3 py-2.5 transition-colors hover:bg-surface-2">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 rounded-2xl border px-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
