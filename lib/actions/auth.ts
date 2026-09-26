"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { completeMfaSession, createSession, destroySession, getPendingMfaSession } from "@/lib/auth/session";
import { audit, type Tx } from "@/lib/services/ledger";
import { checkSecondFactor, isThrottled, recordAttempt } from "@/lib/services/security";
import { fail, type ActionResult } from "./result";

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

  const db = await getDb();
  const tx = db as unknown as Tx;
  const meta = await requestMeta();
  // Freno a la fuerza bruta guardado en la base: funciona aunque Vercel use varios servidores.
  if (await isThrottled(tx, email, meta.ip)) return fail("Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.");

  const [user] = await db.select().from(s.users).where(eq(sql`lower(${s.users.email})`, email));
  const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  await recordAttempt(tx, email, meta.ip, !!valid);
  if (!valid) return fail("Correo o contraseña incorrectos.");

  const next = safeNext(form.get("next"));
  if (user.totpEnabledAt) {
    // Contraseña correcta: falta el código. La sesión no da acceso hasta verificarlo.
    await createSession(user.id, meta, { mfaPending: true });
    redirect(`/login/verificar${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  await createSession(user.id, meta);
  await audit(db, user.id, "login", "users", user.id);
  redirect(next);
}

/** Segundo paso del login: código de la app autenticadora o un código de recuperación. */
export async function verifySecondFactor(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const pending = await getPendingMfaSession();
  if (!pending) return fail("La verificación expiró. Vuelve a iniciar sesión.");
  const db = await getDb();
  const tx = db as unknown as Tx;
  const meta = await requestMeta();
  const key = `2fa:${pending.user.email.toLowerCase()}`;
  if (await isThrottled(tx, key, meta.ip)) return fail("Demasiados intentos. Espera 15 minutos.");

  const how = await checkSecondFactor(tx, pending.user.id, String(form.get("code") ?? ""));
  await recordAttempt(tx, key, meta.ip, !!how);
  if (!how) return fail("Código incorrecto.");

  await completeMfaSession(pending.session.id, pending.user.id);
  await audit(db, pending.user.id, how === "recovery" ? "login_recovery_code" : "login", "users", pending.user.id);
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
