"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions/result";

/**
 * Diálogo con formulario conectado a una server action. Los campos llegan como `children`
 * (pueden renderizarse en el servidor). Al guardar bien: cierra y muestra un aviso.
 */
export function FormDialog({
  title,
  description,
  trigger,
  action,
  submitLabel = "Guardar",
  children,
  wide,
}: {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, form: FormData) => {
    const result = await action(prev, form);
    if (result.ok) {
      setOpen(false);
      toast.success(result.message ?? "Guardado");
    }
    return result;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* onSubmit en vez de action={…}: React reinicia el formulario tras una action y
            borraría lo escrito cuando hay un error de validación. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex min-h-0 flex-col"
        >
          <div className="flex max-h-[65dvh] flex-col gap-4 overflow-x-hidden overflow-y-auto px-1 pt-1 pb-4">
            {children}
            {state && !state.ok && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
