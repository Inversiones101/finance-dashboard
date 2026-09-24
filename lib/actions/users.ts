"use server";

import { z } from "zod";
import { and, count, eq, ne, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { getSessionUser } from "@/lib/auth/session";
import { MODULES } from "@/lib/auth/permissions";
import type { Tx } from "@/lib/services/ledger";
import { mutate } from "./mutate";
import { fail, parseForm, zId, zOptId, zText, type ActionResult } from "./result";

const userSchema = z.object({
  id: zOptId,
  name: zText,
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  roleId: zId,
  password: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().min(PASSWORD_MIN_LENGTH, `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`).nullable()),
  isActive: z.preprocess((v) => v === "on", z.boolean()),
});

/** Evita quedarse sin ningún admin activo (bloquearía la gestión de usuarios). */
async function assertAdminRemains(tx: Tx, excludingUserId: string) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(s.users)
    .innerJoin(s.roles, eq(s.roles.id, s.users.roleId))
    .where(and(eq(s.roles.key, "admin"), eq(s.users.isActive, true), ne(s.users.id, excludingUserId)));
  if (n === 0) throw new Error("Debe quedar al menos un Administrador activo.");
}

export async function saveUserAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(userSchema, form);
  if (!p.data) return fail(p.error);
  const { id, password, ...v } = p.data;
  if (!id && !password) return fail("Define una contraseña temporal para el nuevo usuario.");
  const me = await getSessionUser();

  return mutate("users", "admin", "users", id ? "update" : "create", async (tx) => {
    const [dup] = await tx.select({ id: s.users.id }).from(s.users).where(eq(sql`lower(${s.users.email})`, v.email));
    if (dup && dup.id !== id) throw new Error("Ya existe un usuario con ese correo.");

    if (id) {
      const [role] = await tx.select().from(s.roles).where(eq(s.roles.id, v.roleId));
      if (role.key !== "admin" || !v.isActive) await assertAdminRemains(tx, id);
      if (id === me?.id && !v.isActive) throw new Error("No puedes desactivar tu propia cuenta.");
      await tx
        .update(s.users)
        .set({ ...v, ...(password ? { passwordHash: await hashPassword(password) } : {}), updatedAt: new Date() })
        .where(eq(s.users.id, id));
      // Si se desactiva o cambia la contraseña, cierra sus sesiones abiertas.
      if (!v.isActive || password) await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
      return { id, message: "Usuario actualizado", diff: { ...v, passwordChanged: !!password } };
    }
    const [row] = await tx.insert(s.users).values({ ...v, passwordHash: await hashPassword(password!) }).returning();
    return { id: row.id, message: "Usuario creado", diff: v };
  });
}

const roleSchema = z.object({ id: zOptId, name: zText, description: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable()) });
const LEVELS = ["none", "read", "write", "admin"] as const;

/** Crea/edita un rol y su matriz de permisos (un <select> por módulo, name="perm_<module>"). */
export async function saveRoleAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const p = parseForm(roleSchema, form);
  if (!p.data) return fail(p.error);
  const { id, ...v } = p.data;
  const perms = MODULES.map((module) => {
    const level = String(form.get(`perm_${module}`) ?? "none");
    return { module, level: (LEVELS as readonly string[]).includes(level) ? (level as (typeof LEVELS)[number]) : "none" };
  });

  return mutate("users", "admin", "roles", id ? "update" : "create", async (tx) => {
    let roleId = id;
    if (id) {
      const [role] = await tx.select().from(s.roles).where(eq(s.roles.id, id));
      if (role.key === "admin") throw new Error("El rol El rol Administrador siempre tiene acceso completo.");
      await tx.update(s.roles).set({ ...v, updatedAt: new Date() }).where(eq(s.roles.id, id));
      await tx.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, id));
    } else {
      const key = v.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Date.now().toString(36);
      const [row] = await tx.insert(s.roles).values({ ...v, key }).returning();
      roleId = row.id;
    }
    await tx.insert(s.rolePermissions).values(perms.map((pm) => ({ roleId: roleId!, ...pm })));
    return { id: roleId, message: id ? "Rol actualizado" : "Rol creado", diff: perms };
  });
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  if (!zId.safeParse(id).success) return fail("Registro inválido");
  return mutate("users", "admin", "roles", "delete", async (tx) => {
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.id, id));
    if (role?.isSystem) throw new Error("Los roles del sistema no se pueden borrar.");
    const [{ n }] = await tx.select({ n: count() }).from(s.users).where(eq(s.users.roleId, id));
    if (n > 0) throw new Error("Hay usuarios con este rol. Reasígnalos primero.");
    await tx.delete(s.roles).where(eq(s.roles.id, id));
    return { id, message: "Rol eliminado" };
  });
}
