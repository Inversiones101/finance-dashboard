import { asc } from "drizzle-orm";
import { Plus, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { requirePage } from "@/lib/auth/session";
import { LEVEL_LABELS, MODULE_LABELS, MODULES as ALL_MODULES } from "@/lib/auth/permissions";

// Aportes del dueño es privado del dueño (no se asigna por rol).
const MODULES = ALL_MODULES.filter((m) => m !== "owner_equity");
import { formatDate } from "@/lib/format";
import { deleteRoleAction, saveRoleAction, saveUserAction } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Panel } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { RowActions } from "@/components/crud/row-actions";
import { StatusBadge } from "@/components/crud/status-badge";
import { CheckboxField, FieldRow, Hidden, SelectField, TextField, type Option } from "@/components/crud/fields";

type User = typeof s.users.$inferSelect;
type Role = typeof s.roles.$inferSelect;
type Perm = typeof s.rolePermissions.$inferSelect;

const LEVEL_OPTIONS: Option[] = Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value, label }));

function UserFields({ roles, d }: { roles: Option[]; d?: User }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre" name="name" defaultValue={d?.name} required />
        <TextField label="Correo" name="email" type="email" defaultValue={d?.email} required />
      </FieldRow>
      <FieldRow>
        <SelectField label="Rol" name="roleId" options={roles} defaultValue={d?.roleId} placeholder="Elige…" required />
        <TextField
          label={d ? "Nueva contraseña" : "Contraseña temporal"}
          name="password"
          type="password"
          required={!d}
          hint={d ? "Déjala vacía para no cambiarla." : "Mínimo 10 caracteres. Compártela por un canal seguro."}
        />
      </FieldRow>
      <CheckboxField name="isActive" label="Activo (puede iniciar sesión)" defaultChecked={d?.isActive ?? true} />
    </>
  );
}

function RoleFields({ d, perms }: { d?: Role; perms?: Perm[] }) {
  return (
    <>
      {d && <Hidden name="id" value={d.id} />}
      <FieldRow>
        <TextField label="Nombre del rol" name="name" defaultValue={d?.name} required placeholder="Ej. Contador" />
        <TextField label="Descripción" name="description" defaultValue={d?.description} />
      </FieldRow>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODULES.map((m) => (
          <SelectField key={m} label={MODULE_LABELS[m]} name={`perm_${m}`} options={LEVEL_OPTIONS} defaultValue={perms?.find((p) => p.module === m)?.level ?? "none"} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Ver: solo lectura · Editar: crear y modificar · Administrar: además borrar, conciliar y configurar.</p>
    </>
  );
}

export default async function UsuariosPage() {
  const me = await requirePage("users", "admin");
  const db = await getDb();
  const [users, roles, perms] = await Promise.all([
    db.select().from(s.users).orderBy(asc(s.users.name)),
    db.select().from(s.roles).orderBy(asc(s.roles.name)),
    db.select().from(s.rolePermissions),
  ]);
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usuarios y permisos" description="Quién entra al sistema y qué puede ver o modificar en cada módulo.">
        <FormDialog title="Nuevo usuario" action={saveUserAction} wide trigger={<Button><Plus className="size-4" /> Nuevo usuario</Button>}>
          <UserFields roles={roleOptions} />
        </FormDialog>
      </PageHeader>

      <Panel title="Usuarios">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Último acceso</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">
                      {u.name} {u.id === me.id && <span className="text-xs text-muted-foreground">(tú)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>{roleName.get(u.roleId)}</TableCell>
                  <TableCell className="text-muted-foreground">{u.lastLoginAt ? formatDate(u.lastLoginAt.toISOString().slice(0, 10)) : "Nunca"}</TableCell>
                  <TableCell>
                    <StatusBadge label={u.isActive ? "Activo" : "Desactivado"} tone={u.isActive ? "good" : "muted"} />
                  </TableCell>
                  <TableCell>
                    <RowActions canEdit wide editTitle={`Editar ${u.name}`} editAction={saveUserAction} editFields={<UserFields roles={roleOptions} d={u} />} canDelete={false} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel
        title="Roles"
        description="El rol Administrador siempre tiene acceso completo. Crea roles a la medida (ej. un contador que solo ve reportes)."
        actions={
          <FormDialog title="Nuevo rol" action={saveRoleAction} wide trigger={<Button size="sm" variant="outline"><ShieldCheck className="size-4" /> Nuevo rol</Button>}>
            <RoleFields />
          </FormDialog>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-surface">Rol</TableHead>
                {MODULES.map((m) => (
                  <TableHead key={m} className="text-center text-xs whitespace-nowrap">
                    {MODULE_LABELS[m]}
                  </TableHead>
                ))}
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => {
                const rp = perms.filter((p) => p.roleId === r.id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="sticky left-0 bg-surface">
                      <p className="font-medium whitespace-nowrap">{r.name}</p>
                      {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                    </TableCell>
                    {MODULES.map((m) => {
                      const level = rp.find((p) => p.module === m)?.level ?? "none";
                      return (
                        <TableCell key={m} className="text-center">
                          <StatusBadge label={LEVEL_LABELS[level]} tone={level === "admin" ? "good" : level === "write" ? "info" : level === "read" ? "muted" : "muted"} />
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {r.key !== "admin" && (
                        <RowActions
                          canEdit
                          canDelete={!r.isSystem}
                          wide
                          editTitle={`Editar rol ${r.name}`}
                          editAction={saveRoleAction}
                          editFields={<RoleFields d={r} perms={rp} />}
                          deleteAction={deleteRoleAction.bind(null, r.id)}
                          deleteLabel={`el rol ${r.name}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </div>
  );
}
