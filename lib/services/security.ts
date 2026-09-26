/**
 * Seguridad de acceso: freno a la fuerza bruta (en la base, así funciona entre servidores de
 * Vercel) y verificación en dos pasos (alta, verificación, códigos de recuperación, baja).
 */
import { and, count, eq, gt, lt } from "drizzle-orm";
import * as s from "@/db/schema";
import { decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newTotpSecret, verifyTotp } from "@/lib/auth/totp";
import type { Tx } from "./ledger";

const WINDOW_MS = 15 * 60_000;
export const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 25;

/** ¿Está bloqueado este correo o esta IP por demasiados intentos fallidos recientes? */
export async function isThrottled(tx: Tx, email: string, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MS);
  const [{ byEmail }] = await tx
    .select({ byEmail: count() })
    .from(s.loginAttempts)
    .where(and(eq(s.loginAttempts.email, email), eq(s.loginAttempts.success, false), gt(s.loginAttempts.createdAt, since)));
  if (byEmail >= MAX_FAILS_PER_EMAIL) return true;
  if (!ip) return false;
  const [{ byIp }] = await tx
    .select({ byIp: count() })
    .from(s.loginAttempts)
    .where(and(eq(s.loginAttempts.ip, ip), eq(s.loginAttempts.success, false), gt(s.loginAttempts.createdAt, since)));
  return byIp >= MAX_FAILS_PER_IP;
}

export async function recordAttempt(tx: Tx, email: string, ip: string | null, success: boolean) {
  await tx.insert(s.loginAttempts).values({ email, ip, success });
  // Limpieza: no hace falta guardar intentos de hace más de 30 días.
  await tx.delete(s.loginAttempts).where(lt(s.loginAttempts.createdAt, new Date(Date.now() - 30 * 86_400_000)));
}

// ── Dos pasos ────────────────────────────────────────────────────────────────

/** Paso 1: genera un secreto nuevo (aún no activo) y lo devuelve para mostrar el QR. */
export async function beginTotpSetup(tx: Tx, userId: string) {
  const [u] = await tx.select().from(s.users).where(eq(s.users.id, userId));
  if (u?.totpEnabledAt) throw new Error("La verificación en dos pasos ya está activa.");
  const secret = newTotpSecret();
  await tx.update(s.users).set({ totpSecretEnc: encryptSecret(secret), totpLastStep: null, updatedAt: new Date() }).where(eq(s.users.id, userId));
  return secret;
}

/** Paso 2: el primer código correcto la activa y entrega los códigos de recuperación (una sola vez). */
export async function confirmTotpSetup(tx: Tx, userId: string, code: string) {
  const [u] = await tx.select().from(s.users).where(eq(s.users.id, userId));
  if (!u?.totpSecretEnc || u.totpEnabledAt) throw new Error("Vuelve a empezar la activación.");
  const step = verifyTotp(decryptSecret(u.totpSecretEnc), code);
  if (step === null) throw new Error("El código no coincide. Revisa que la hora del teléfono esté bien y usa el código actual.");
  const codes = newRecoveryCodes();
  await tx
    .update(s.users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: codes.map(hashRecoveryCode), updatedAt: new Date() })
    .where(eq(s.users.id, userId));
  return codes;
}

/**
 * Verifica un código de la app o uno de recuperación (que se gasta al usarse).
 * Devuelve cómo se verificó, o null si no coincide.
 */
export async function checkSecondFactor(tx: Tx, userId: string, input: string): Promise<"totp" | "recovery" | null> {
  const [u] = await tx.select().from(s.users).where(eq(s.users.id, userId));
  if (!u?.totpEnabledAt || !u.totpSecretEnc) return null;
  const clean = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(clean)) {
    const step = verifyTotp(decryptSecret(u.totpSecretEnc), clean, { lastStep: u.totpLastStep });
    if (step === null) return null;
    await tx.update(s.users).set({ totpLastStep: step }).where(eq(s.users.id, userId));
    return "totp";
  }
  const hashes = Array.isArray(u.recoveryCodes) ? (u.recoveryCodes as string[]) : [];
  const h = hashRecoveryCode(clean);
  if (!hashes.includes(h)) return null;
  await tx.update(s.users).set({ recoveryCodes: hashes.filter((x) => x !== h) }).where(eq(s.users.id, userId));
  return "recovery";
}

export async function disableTotp(tx: Tx, userId: string) {
  await tx.update(s.users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null, updatedAt: new Date() }).where(eq(s.users.id, userId));
}

export async function regenerateRecoveryCodes(tx: Tx, userId: string) {
  const codes = newRecoveryCodes();
  await tx.update(s.users).set({ recoveryCodes: codes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(s.users.id, userId));
  return codes;
}
