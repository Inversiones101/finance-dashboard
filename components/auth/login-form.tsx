"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, setupAdmin } from "@/lib/actions/auth";

export function LoginForm({ mode, next, needsSetupToken }: { mode: "login" | "setup"; next?: string; needsSetupToken?: boolean }) {
  const [state, action, pending] = useActionState(mode === "setup" ? setupAdmin : login, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      {mode === "setup" && needsSetupToken && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setupToken">Código de configuración</Label>
          <Input id="setupToken" name="setupToken" autoComplete="off" required />
          <p className="text-xs text-muted-foreground">Solo se pide una vez, para crear la primera cuenta.</p>
        </div>
      )}
      {mode === "setup" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus={mode === "login"} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} required />
      </div>
      {mode === "setup" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Confirmar contraseña</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          <p className="text-xs text-muted-foreground">Mínimo 10 caracteres.</p>
        </div>
      )}
      {state && !state.ok && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-1">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {mode === "setup" ? "Crear cuenta de administrador" : "Entrar"}
      </Button>
    </form>
  );
}
