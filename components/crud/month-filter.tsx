"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Navegador de meses que vive en la URL (?mes=2026-09): se puede compartir y volver atrás. */
export function MonthFilter({ month, allowAll }: { month: string | null; allowAll?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (m: string | null) => {
    const q = new URLSearchParams(params);
    if (m) q.set("mes", m);
    else q.set("mes", "todos");
    router.push(`${pathname}?${q}`);
  };
  const current = month ?? new Date().toISOString().slice(0, 7);
  const label = month ? `${NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : "Todos los meses";

  return (
    <div className="flex items-center gap-1 rounded-full border bg-surface p-0.5 shadow-card">
      <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => go(shift(current, -1))} aria-label="Mes anterior">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 text-center text-sm font-medium capitalize">{label}</span>
      <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => go(shift(current, 1))} aria-label="Mes siguiente">
        <ChevronRight className="size-4" />
      </Button>
      {allowAll && month && (
        <Button variant="ghost" size="sm" className="rounded-full text-xs" onClick={() => go(null)}>
          Ver todo
        </Button>
      )}
    </div>
  );
}
