"use client";

import { startTransition, useActionState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";

/** Formulario en página (no en diálogo) conectado a una server action. */
export function InlineForm({
  action,
  submitLabel,
  children,
  resetOnSuccess,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
  resetOnSuccess?: boolean;
}) {
  const [state, run, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const r = await action(prev, form);
    if (r.ok) toast.success(r.message ?? "Guardado");
    return r;
  }, null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const data = new FormData(el);
        startTransition(async () => {
          run(data);
          if (resetOnSuccess) el.reset();
        });
      }}
      className="flex flex-col gap-4"
    >
      {children}
      {state && !state.ok && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="size-4 animate-spin" />} {submitLabel}
      </Button>
    </form>
  );
}
