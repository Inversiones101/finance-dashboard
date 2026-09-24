"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/auth/password";
import { resolvePrefs, type DashboardPrefs } from "@/lib/dashboard-widgets";
import { fail, ok, type ActionResult } from "./result";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre"),
  title: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(60, "Máximo 60 caracteres").nullable()),
});

/** Cada persona edita su propio nombre y cargo. */
export async function saveProfileAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Tu sesión expiró.");
  const p = profileSchema.safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return fail(p.error.issues[0].message);
  const db = await getDb();
  await db.update(s.users).set({ ...p.data, updatedAt: new Date() }).where(eq(s.users.id, user.id));
  revalidatePath("/", "layout");
  return ok("Perfil actualizado");
}

const passwordSchema = z.object({
  current: z.string().min(1, "Escribe tu contraseña actual"),
  password: z.string().min(PASSWORD_MIN_LENGTH, `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`),
  confirm: z.string(),
});

export async function changePasswordAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Tu sesión expiró.");
  const p = passwordSchema.safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return fail(p.error.issues[0].message);
  if (p.data.password !== p.data.confirm) return fail("Las contraseñas nuevas no coinciden.");
  const db = await getDb();
  const [row] = await db.select().from(s.users).where(eq(s.users.id, user.id));
  if (!(await verifyPassword(p.data.current, row.passwordHash))) return fail("La contraseña actual no es correcta.");
  await db.update(s.users).set({ passwordHash: await hashPassword(p.data.password), updatedAt: new Date() }).where(eq(s.users.id, user.id));
  return ok("Contraseña actualizada");
}

/** Guarda orden/visibilidad de widgets y si las alertas están plegadas. */
export async function saveDashboardPrefsAction(prefs: DashboardPrefs): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail("Tu sesión expiró.");
  const db = await getDb();
  await db.update(s.users).set({ dashboardPrefs: resolvePrefs(prefs) }).where(eq(s.users.id, user.id));
  revalidatePath("/");
  return ok("Dashboard actualizado");
}
