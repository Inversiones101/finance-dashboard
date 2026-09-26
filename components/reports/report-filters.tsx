"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const VIEWS = [
  { value: "mes", label: "Mes" },
  { value: "trimestre", label: "Trimestre" },
  { value: "anio", label: "Año" },
];

const REPORTS = [
  { value: "resultados", label: "Estado de resultados" },
  { value: "flujo", label: "Flujo de efectivo" },
  { value: "balance", label: "Balance general" },
  { value: "productos", label: "Productos y afiliados" },
];

export function ReportTabs({ report }: { report: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border bg-surface p-1 shadow-card" role="tablist">
      {REPORTS.map((r) => (
        <button
          key={r.value}
          role="tab"
          aria-selected={report === r.value}
          onClick={() => {
            const q = new URLSearchParams(params);
            q.set("reporte", r.value);
            router.push(`${pathname}?${q}`);
          }}
          className={cn("rounded-xl px-3 py-1.5 text-sm transition-colors", report === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function ReportFilters({ view, from, to, currency, hideView }: { view: string; from: string; to: string; currency: string; hideView?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (patch: Record<string, string>) => {
    const q = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => q.set(k, v));
    router.push(`${pathname}?${q}`);
  };
  const seg = "rounded-full px-3 py-1 text-sm transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hideView && <div className="flex rounded-full border bg-surface p-0.5 shadow-card" role="radiogroup" aria-label="Agrupar por">
        {VIEWS.map((v) => (
          <button key={v.value} role="radio" aria-checked={view === v.value} onClick={() => set({ vista: v.value })} className={cn(seg, view === v.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {v.label}
          </button>
        ))}
      </div>}
      {!hideView && <label className="flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-sm shadow-card">
        <span className="text-muted-foreground">Desde</span>
        <input type="month" value={from} onChange={(e) => e.target.value && set({ desde: e.target.value })} className="bg-transparent outline-none" />
      </label>}
      <label className="flex items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-sm shadow-card">
        <span className="text-muted-foreground">{hideView ? "Al cierre de" : "Hasta"}</span>
        <input type="month" value={to} onChange={(e) => e.target.value && set({ hasta: e.target.value })} className="bg-transparent outline-none" />
      </label>
      <div className="flex rounded-full border bg-surface p-0.5 shadow-card" role="radiogroup" aria-label="Moneda">
        {["USD", "HNL"].map((c) => (
          <button key={c} role="radio" aria-checked={currency === c} onClick={() => set({ moneda: c })} className={cn(seg, currency === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
