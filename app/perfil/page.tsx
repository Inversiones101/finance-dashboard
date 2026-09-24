import { redirect } from "next/navigation";
import { BadgeCheck, KeyRound, UserRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { changePasswordAction, saveProfileAction } from "@/lib/actions/profile";
import { PageHeader, Panel } from "@/components/crud/page-header";
import { FieldRow, TextField } from "@/components/crud/fields";
import { InlineForm } from "@/components/profile/inline-form";

export default async function PerfilPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
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
    </div>
  );
}
