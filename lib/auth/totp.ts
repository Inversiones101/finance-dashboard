/**
 * Verificación en dos pasos (TOTP, RFC 6238): el código de 6 dígitos de Google Authenticator,
 * 1Password, Authy… Sin dependencias: HMAC-SHA1 sobre pasos de 30 s.
 * El secreto se guarda cifrado (AES-256-GCM) con una llave derivada de APP_SECRET.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Secreto inválido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP);

/**
 * Verifica un código aceptando ±1 paso (relojes desfasados). Devuelve el paso que coincidió para
 * que no se pueda reusar el mismo código (`lastStep`), o null.
 */
export function verifyTotp(secret: string, code: string, { lastStep = null, nowMs = Date.now() }: { lastStep?: number | null; nowMs?: number } = {}) {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const now = currentStep(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "Inversiones 101") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

// ── Cifrado del secreto ─────────────────────────────────────────────────────

function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("Falta APP_SECRET en Vercel para activar la verificación en dos pasos.");
  return createHash("sha256").update(`totp:${secret}`).digest();
}

export const encryptionReady = () => (process.env.APP_SECRET?.length ?? 0) >= 32;

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(enc: string) {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1") throw new Error("Formato de secreto desconocido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

// ── Códigos de recuperación ─────────────────────────────────────────────────

/** 8 códigos de un solo uso, por si pierdes el teléfono. Se muestran una vez; se guarda su hash. */
export function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = base32Encode(randomBytes(6)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.trim().toLowerCase().replace(/\s+/g, "")).digest("hex");
