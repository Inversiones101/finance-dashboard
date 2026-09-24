"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WIDGETS, type DashboardPrefs, type WidgetId } from "@/lib/dashboard-widgets";
import { saveDashboardPrefsAction } from "@/lib/actions/profile";

const LABEL = Object.fromEntries(WIDGETS.map((w) => [w.id, w.label])) as Record<WidgetId, string>;

/** Elegir qué widgets ver y en qué orden. */
export function CustomizeDashboard({ prefs }: { prefs: DashboardPrefs }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<WidgetId[]>(prefs.order);
  const [hidden, setHidden] = useState<Set<WidgetId>>(new Set(prefs.hidden));
  const [pending, start] = useTransition();
  const router = useRouter();

  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const n = [...o];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  function save() {
    start(async () => {
      const r = await saveDashboardPrefsAction({ order, hidden: [...hidden], alertsCollapsed: prefs.alertsCollapsed });
      if (r.ok) {
        toast.success("Dashboard actualizado");
        setOpen(false);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setOrder(prefs.order);
          setHidden(new Set(prefs.hidden));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <SlidersHorizontal className="size-3.5" /> Personalizar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Personalizar dashboard</DialogTitle>
          <DialogDescription>Muestra, oculta y ordena los bloques. Se guarda en tu usuario.</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
              <label className="flex flex-1 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!hidden.has(id)}
                  onChange={(e) =>
                    setHidden((h) => {
                      const n = new Set(h);
                      if (e.target.checked) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                  }
                  className="size-4 accent-[var(--primary)]"
                />
                <span className={hidden.has(id) ? "text-muted-foreground line-through" : ""}>{LABEL[id]}</span>
              </label>
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${LABEL[id]}`}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Bajar ${LABEL[id]}`}>
                <ArrowDown className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
