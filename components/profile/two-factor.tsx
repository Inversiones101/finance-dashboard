"use client";

import { useState, useTransition } from "react";
import { Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmTotpAction, disableTotpAction, regenerateRecoveryAction, startTotpAction } from "@/lib/actions/security";

type Stage = { kind: "idle" } | { kind: "scan"; qrSvg: string; secret: string } | { kind: "codes"; codes: string[] } | { kind: "manage"; action: "disable" | "regenerate" };

function CodeInput({ value, onChange, placeholder = "123 456" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={11}
      placeholder={placeholder}
      className="max-w-44 text-center font-heading text-lg tracking-[0.25em] tabular"
      autoFocus
    />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `Códigos de recuperación · Inversiones 101\nCada uno sirve una sola vez.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "codigos-recuperacion-inversiones101.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-semibold">Guarda estos códigos ahora</span> (en tu gestor de contraseñas o impresos). Si pierdes el teléfono, cada uno te deja entrar una vez. No se volverán a mostrar.
      </p>
      <ul className="grid grid-cols-2 gap-1.5 rounded-2xl border bg-surface-2 p-3 font-mono text-sm sm:grid-cols-4">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Copiados"), () => toast.error("No se pudo copiar"))}
        >
          <Copy className="size-3.5" /> Copiar
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="size-3.5" /> Descargar .txt
        </Button>
        <Button size="sm" onClick={onDone}>
          Ya los guardé
        </Button>
      </div>
    </div>
  );
}

/** Activar / administrar la verificación en dos pasos desde Mi perfil. */
export function TwoFactor({ enabledAt, recoveryLeft }: { enabledAt: string | null; recoveryLeft: number }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reset = () => (setStage({ kind: "idle" }), setCode(""), setError(null));

  const run = <T,>(fn: () => Promise<T>, then: (r: T) => void) =>
    start(async () => {
      setError(null);
      then(await fn());
    });

  if (stage.kind === "codes") return <RecoveryCodes codes={stage.codes} onDone={reset} />;

  if (!enabledAt) {
    if (stage.kind === "scan") {
      return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="size-44 shrink-0 rounded-2xl bg-white p-2 [&_svg]:size-full" aria-label="Código QR para la app autenticadora" dangerouslySetInnerHTML={{ __html: stage.qrSvg }} />
          <div className="flex flex-col gap-3 text-sm">
            <ol className="list-decimal space-y-1 pl-4">
              <li>Abre tu app autenticadora (Google Authenticator, 1Password, Authy…) y escanea el código.</li>
              <li>
                ¿No puedes escanear? Escribe esta clave: <span className="font-mono text-xs break-all select-all">{stage.secret}</span>
              </li>
              <li>Escribe el código de 6 dígitos que aparece:</li>
            </ol>
            <div className="flex gap-2">
              <CodeInput value={code} onChange={setCode} />
              <Button
                disabled={pending || code.replace(/\s/g, "").length !== 6}
                onClick={() =>
                  run(
                    () => confirmTotpAction(code),
                    (r) => (r.ok ? (toast.success("Verificación en dos pasos activada"), setStage({ kind: "codes", codes: r.data.codes })) : setError(r.error))
                  )
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />} Activar
              </Button>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="button" onClick={reset} className="w-fit text-xs text-muted-foreground hover:underline">
              Cancelar
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Además de tu contraseña, al entrar se pedirá un código de 6 dígitos de tu teléfono. Si alguien obtiene tu contraseña, no podrá entrar.
        </p>
        <div>
          <Button disabled={pending} onClick={() => run(startTotpAction, (r) => (r.ok ? setStage({ kind: "scan", ...r.data }) : setError(r.error)))}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Activar verificación en dos pasos
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm">
        <ShieldCheck className="size-4 text-success" />
        <span>
          <span className="font-medium">Activa</span> desde {new Date(enabledAt).toLocaleDateString("es-HN", { dateStyle: "long" })} ·{" "}
          <span className={recoveryLeft <= 2 ? "font-medium text-warning" : "text-muted-foreground"}>
            {recoveryLeft} código{recoveryLeft === 1 ? "" : "s"} de recuperación disponible{recoveryLeft === 1 ? "" : "s"}
          </span>
        </span>
      </p>
      {stage.kind === "manage" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{stage.action === "disable" ? "Para desactivarla, escribe el código actual de tu app (o uno de recuperación)." : "Escribe el código actual de tu app para generar códigos nuevos (los anteriores dejan de servir)."}</p>
          <div className="flex flex-wrap gap-2">
            <CodeInput value={code} onChange={setCode} placeholder={stage.action === "disable" ? "Código" : "123 456"} />
            <Button
              variant={stage.action === "disable" ? "destructive" : "default"}
              disabled={pending || !code.trim()}
              onClick={() =>
                stage.action === "disable"
                  ? run(() => disableTotpAction(code), (r) => (r.ok ? (toast.success(r.message ?? "Listo"), reset()) : setError(r.error)))
                  : run(() => regenerateRecoveryAction(code), (r) => (r.ok ? setStage({ kind: "codes", codes: r.data.codes }) : setError(r.error)))
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {stage.action === "disable" ? "Desactivar" : "Generar códigos"}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setStage({ kind: "manage", action: "regenerate" })}>
            Nuevos códigos de recuperación
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" onClick={() => setStage({ kind: "manage", action: "disable" })}>
            <ShieldOff className="size-3.5" /> Desactivar
          </Button>
        </div>
      )}
    </div>
  );
}
