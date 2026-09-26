"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifySecondFactor } from "@/lib/actions/auth";

export function SecondFactorForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(verifySecondFactor, null);
  const [recovery, setRecovery] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">{recovery ? "Código de recuperación" : "Código de 6 dígitos"}</Label>
        {recovery ? (
          <Input key="rec" id="code" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" required autoFocus />
        ) : (
          <Input
            key="otp"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            placeholder="123 456"
            required
            autoFocus
            className="text-center font-heading text-2xl tracking-[0.3em] tabular"
          />
        )}
        <p className="text-xs text-muted-foreground">
          {recovery ? "Cada código de recuperación sirve una sola vez." : "Ábrelo en tu app autenticadora (Google Authenticator, 1Password, Authy…)."}
        </p>
      </div>
      {state && !state.ok && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />} Verificar
      </Button>
      <button type="button" onClick={() => setRecovery((r) => !r)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        {recovery ? "Usar el código de la app" : "¿Perdiste el teléfono? Usa un código de recuperación"}
      </button>
    </form>
  );
}
