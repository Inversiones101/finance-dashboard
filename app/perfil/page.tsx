import { redirect } from "next/navigation";
import { and, desc, eq, gt } from "drizzle-orm";
import { BadgeCheck, KeyRound, Laptop, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { currentSessionHash, getSessionUser } from "@/lib/auth/session";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/lib/actions/security";
import { TwoFactor } from "@/components/profile/two-factor";
import { ActionButton } from "@/components/crud/action-button";
import { changePasswordAction, saveProfileAction } from "@/lib/actions/profile";
import { PageHeader, Panel } from "@/components/crud/page-header";
import { FieldRow, TextField } from "@/components/crud/fields";
import { InlineForm } from "@/components/profile/inline-form";

export default async function PerfilPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const db = await getDb();
  const [[me], sessions, current] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, user.id)),
    db
      .select()
      .from(s.sessions)
      .where(and(eq(s.sessions.userId, user.id), eq(s.sessions.mfaPending, false), gt(s.sessions.expiresAt, new Date())))
      .orderBy(desc(s.sessions.lastSeenAt)),
    currentSessionHash(),
  ]);
  const recoveryLeft = Array.isArray(me.recoveryCodes) ? me.recoveryCodes.length : 0;
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Mi perfil" description="Tu nombre y tu cargo aparecen en la barra superior y en el saludo del dashboard." />

      <div className="flex items-center gap-4 rounded-3xl border bg-surface p-5 shadow-card">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent font-heading text-lg font-bold text-accent-foreground">{initials}</span>
        <div>
          <p className="font-heading text-xl font-bold">{user.name}</p>
          <p className="text-sm text-muted-foreground">
            {user.title ?? "Sin cargo"} · {user.email}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <BadgeCheck className="size-3.5" /> Rol: {user.roleName}
          </p>
        </div>
      </div>

      <Panel title="Datos" description="El cargo es libre: Fundador, Contador, Asistente…" actions={<UserRound className="size-4 text-muted-foreground" />}>
        <InlineForm action={saveProfileAction} submitLabel="Guardar">
          <FieldRow>
            <TextField label="Nombre" name="name" defaultValue={user.name} required />
            <TextField label="Cargo" name="title" defaultValue={user.title} placeholder="Ej. Fundador" />
          </FieldRow>
        </InlineForm>
      </Panel>

      <Panel title="Contraseña" actions={<KeyRound className="size-4 text-muted-foreground" />}>
        <InlineForm action={changePasswordAction} submitLabel="Cambiar contraseña" resetOnSuccess>
          <TextField label="Contraseña actual" name="current" type="password" required />
          <FieldRow>
            <TextField label="Nueva contraseña" name="password" type="password" required hint="Mínimo 10 caracteres." />
            <TextField label="Confirmar" name="confirm" type="password" required />
          </FieldRow>
        </InlineForm>
      </Panel>

      <Panel title="Verificación en dos pasos" description="Recomendada: protege la cuenta aunque alguien conozca tu contraseña." actions={<ShieldCheck className="size-4 text-muted-foreground" />}>
        <TwoFactor enabledAt={me.totpEnabledAt?.toISOString() ?? null} recoveryLeft={recoveryLeft} />
      </Panel>

      <Panel
        title="Sesiones activas"
        description="Dispositivos donde tu cuenta está abierta. Cierra las que no reconozcas."
        actions={
          sessions.length > 1 ? (
            <ActionButton action={revokeOtherSessionsAction} size="sm" variant="outline">
              Cerrar las demás
            </ActionButton>
          ) : undefined
        }
      >
        <ul className="divide-y">
          {sessions.map((x) => {
            const ua = x.userAgent ?? "";
            const mobile = /iphone|android|mobile/i.test(ua);
            const device = [
              /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "Dispositivo",
              /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const isCurrent = x.tokenHash === current;
            return (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-foreground/70">
                  {mobile ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {device}
                    {isCurrent && <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">Este dispositivo</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Iniciada {x.createdAt.toLocaleDateString("es-HN", { dateStyle: "medium" })}
                    {x.lastSeenAt && ` · activa ${x.lastSeenAt.toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tegucigalpa" })}`}
                    {x.ip && ` · IP ${x.ip}`}
                  </p>
                </div>
                {!isCurrent && (
                  <ActionButton action={revokeSessionAction.bind(null, x.id)} size="sm" variant="ghost" className="text-muted-foreground hover:text-danger">
                    Cerrar
                  </ActionButton>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
