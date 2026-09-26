"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { currentSessionHash, getSessionUser } from "@/lib/auth/session";
import { encryptionReady, otpauthUri } from "@/lib/auth/totp";
import { audit, type Tx } from "@/lib/services/ledger";
import { beginTotpSetup, checkSecondFactor, confirmTotpSetup, disableTotp, regenerateRecoveryCodes } from "@/lib/services/security";
import { errorMessage, fail, ok, type ActionResult } from "./result";

type WithData<T> = { ok: true; data: T } | { ok: false; error: string };

async function me() {
  const user = await getSessionUser();
  if (!user) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  return { user, db: (await getDb()) as unknown as Tx };
}

/** Paso 1: QR y clave para agregar la cuenta en la app autenticadora. */
export async function startTotpAction(): Promise<WithData<{ qrSvg: string; secret: string }>> {
  try {
    if (!encryptionReady()) return { ok: false, error: "Falta APP_SECRET en Vercel. Agrégalo y vuelve a desplegar." };
    const { user, db } = await me();
    const secret = await beginTotpSetup(db, user.id);
    const qrSvg = await QRCode.toString(otpauthUri(secret, user.email), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { ok: true, data: { qrSvg, secret: secret.match(/.{1,4}/g)!.join(" ") } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Paso 2: el primer código la activa. Devuelve los códigos de recuperación (se muestran una sola vez). */
export async function confirmTotpAction(code: string): Promise<WithData<{ codes: string[] }>> {
  try {
    const { user, db } = await me();
    const codes = await confirmTotpSetup(db, user.id, code);
    await audit(db, user.id, "enable_2fa", "users", user.id);
    revalidatePath("/perfil");
    return { ok: true, data: { codes } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function regenerateRecoveryAction(code: string): Promise<WithData<{ codes: string[] }>> {
  try {
    const { user, db } = await me();
    if ((await checkSecondFactor(db, user.id, code)) !== "totp") return { ok: false, error: "Escribe el código actual de tu app." };
    const codes = await regenerateRecoveryCodes(db, user.id);
    await audit(db, user.id, "regenerate_recovery_codes", "users", user.id);
    revalidatePath("/perfil");
    return { ok: true, data: { codes } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function disableTotpAction(code: string): Promise<ActionResult> {
  try {
    const { user, db } = await me();
    if (!(await checkSecondFactor(db, user.id, code))) return fail("Código incorrecto.");
    await disableTotp(db, user.id);
    await audit(db, user.id, "disable_2fa", "users", user.id);
    revalidatePath("/perfil");
    return ok("Verificación en dos pasos desactivada");
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** Cierra una sesión propia (otro dispositivo). */
export async function revokeSessionAction(id: string): Promise<ActionResult> {
  try {
    const { user, db } = await me();
    await db.delete(s.sessions).where(and(eq(s.sessions.id, id), eq(s.sessions.userId, user.id)));
    await audit(db, user.id, "revoke_session", "sessions", id);
    revalidatePath("/perfil");
    return ok("Sesión cerrada");
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  try {
    const { user, db } = await me();
    const current = await currentSessionHash();
    if (!current) return fail("Sesión inválida");
    await db.delete(s.sessions).where(and(eq(s.sessions.userId, user.id), ne(s.sessions.tokenHash, current)));
    await audit(db, user.id, "revoke_other_sessions", "sessions", null);
    revalidatePath("/perfil");
    return ok("Se cerraron las demás sesiones");
  } catch (e) {
    return fail(errorMessage(e));
  }
}
