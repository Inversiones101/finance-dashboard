"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/services/ledger";
import { fail, type ActionResult } from "./result";

// Freno simple a ataques de fuerza bruta: 5 intentos fallidos por correo ⇒ 5 minutos de espera.
const failures = new Map<string, { n: number; until: number }>();

function safeNext(next: FormDataEntryValue | null) {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

async function requestMeta() {
  const h = await headers();
  return { userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null };
}

export async function login(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return fail("Escribe tu correo y contraseña.");

  const f = failures.get(email);
  if (f && f.until > Date.now()) return fail("Demasiados intentos. Espera unos minutos.");

  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(sql`lower(${s.users.email})`, email));
  const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    const n = (f?.n ?? 0) + 1;
    failures.set(email, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return fail("Correo o contraseña incorrectos.");
  }

  failures.delete(email);
  await createSession(user.id, await requestMeta());
  await audit(db, user.id, "login", "users", user.id);
  redirect(safeNext(form.get("next")));
}

const setupSchema = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  password: z.string().min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`),
  confirm: z.string(),
});

/** En producción, SETUP_TOKEN evita que un extraño cree el primer admin antes que el dueño. */
function setupTokenOk(given: FormDataEntryValue | null) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return true;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(String(given ?? "")), digest(expected));
}

/** Crea el primer usuario (Administrador). Solo funciona mientras no exista ningún usuario. */
export async function setupAdmin(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!setupTokenOk(form.get("setupToken"))) return fail("El código de configuración no es correcto.");
  const parsed = setupSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (parsed.data.password !== parsed.data.confirm) return fail("Las contraseñas no coinciden.");

  const db = await getDb();
  const userId = await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(s.users);
    if (n > 0) return null;
    const [admin] = await tx.select().from(s.roles).where(eq(s.roles.key, "admin"));
    const [u] = await tx
      .insert(s.users)
      .values({ name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password), roleId: admin.id, isOwner: true })
      .returning({ id: s.users.id });
    await audit(tx, u.id, "create", "users", u.id, { setup: true });
    return u.id;
  });
  if (!userId) return fail("Ya existe un administrador. Inicia sesión.");

  await createSession(userId, await requestMeta());
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
