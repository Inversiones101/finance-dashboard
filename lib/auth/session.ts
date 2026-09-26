import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { can, firstAllowedPath, MODULE_HOME, MODULES, type Level, type Module, type Permissions } from "./permissions";

export const SESSION_COOKIE = "i101_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  title: string | null;
  isOwner: boolean;
  permissions: Permissions;
};

const MFA_MINUTES = 10;

async function setCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/**
 * Crea la sesión: en la cookie va un token aleatorio; en la BD, solo su hash.
 * Con `mfaPending`, la sesión no da acceso a nada hasta que se verifique el código (10 min).
 */
export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null } = {}, { mfaPending = false } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (mfaPending ? MFA_MINUTES * 60_000 : SESSION_DAYS * 86_400_000));
  const db = await getDb();
  await db.insert(s.sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: meta.userAgent ?? null, ip: meta.ip ?? null, mfaPending, lastSeenAt: new Date() });
  if (!mfaPending) await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, userId));
  await setCookie(token, expiresAt);
}

/** Sesión a medio camino (contraseña correcta, falta el código). */
export async function getPendingMfaSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ session: s.sessions, user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.tokenHash, hashToken(token)), eq(s.sessions.mfaPending, true), gt(s.sessions.expiresAt, new Date()), eq(s.users.isActive, true)));
  return row ?? null;
}

/** Código correcto: la sesión pasa a ser normal (30 días). */
export async function completeMfaSession(sessionId: string, userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("La sesión expiró. Vuelve a iniciar sesión.");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const db = await getDb();
  await db.update(s.sessions).set({ mfaPending: false, expiresAt, lastSeenAt: new Date() }).where(eq(s.sessions.id, sessionId));
  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, userId));
  await setCookie(token, expiresAt);
}

/** Hash del token de la sesión actual (para marcar "este dispositivo" en la lista de sesiones). */
export async function currentSessionHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(s.sessions).where(eq(s.sessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Usuario de la sesión actual (una consulta por request gracias a `cache`). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: s.users, role: s.roles, session: s.sessions })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .innerJoin(s.roles, eq(s.roles.id, s.users.roleId))
    .where(and(eq(s.sessions.tokenHash, hashToken(token)), eq(s.sessions.mfaPending, false), gt(s.sessions.expiresAt, new Date()), eq(s.users.isActive, true)));
  if (!row) return null;
  // "Última actividad" para la lista de sesiones, sin escribir en cada request.
  if (!row.session.lastSeenAt || Date.now() - row.session.lastSeenAt.getTime() > 15 * 60_000) {
    await db.update(s.sessions).set({ lastSeenAt: new Date() }).where(eq(s.sessions.id, row.session.id));
  }

  const perms = await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, row.role.id));
  const level = (m: Module) => perms.find((p) => p.module === m)?.level;
  // Módulos nuevos sin fila guardada heredan un permiso razonable (Planeación ⇐ Reportes).
  const permissions = Object.fromEntries(
    MODULES.map((m) => [m, level(m) ?? (row.role.key === "admin" ? "admin" : m === "planning" ? (level("reports") ?? "none") : "none")])
  ) as Permissions;
  return { id: row.user.id, name: row.user.name, email: row.user.email, roleId: row.role.id, roleName: row.role.name, title: row.user.title, isOwner: row.user.isOwner, permissions };
});

/** Para páginas: redirige al login o al inicio si no tiene permiso. */
export async function requirePage(module: Module, level: Level = "read") {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.permissions, module, level)) {
    const home = firstAllowedPath(user.permissions);
    redirect(home && home !== MODULE_HOME[module] ? home : "/sin-acceso");
  }
  return user;
}

/** Sección privada del dueño: nadie más la ve, ni siquiera otros admins. */
export async function requireOwner() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isOwner) redirect("/");
  return user;
}

/** Para server actions: devuelve el usuario o un error legible (nunca confía en la UI). */
export async function authorize(module: Module, level: Level) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Tu sesión expiró. Vuelve a iniciar sesión." } as const;
  if (!can(user.permissions, module, level)) return { user: null, error: "No tienes permiso para hacer esto." } as const;
  return { user, error: null } as const;
}
