/**
 * Respaldo de la base: todas las tablas en un JSON comprimido (gzip). Se guarda cada semana en
 * Vercel Blob **privado** (solo el servidor lo lee) y también se puede descargar a mano.
 * No incluye sesiones ni intentos de login (son temporales). Los secretos de dos pasos van
 * cifrados y las contraseñas como hash, igual que en la base.
 */
import { gzipSync } from "node:zlib";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "./ledger";

const SKIP = new Set(["sessions", "login_attempts"]);
const PREFIX = "respaldos/";
const KEEP = 12; // ~3 meses de respaldos semanales

export async function buildBackup(tx: Tx) {
  const tables = (Object.values(s) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    const name = getTableConfig(t).name;
    if (SKIP.has(name)) continue;
    data[name] = await tx.select().from(t);
  }
  const payload = { app: "inversiones101-finanzas", version: 1, createdAt: new Date().toISOString(), tables: data };
  const json = JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? Number(v) : v));
  return { gz: gzipSync(json), rows: Object.values(data).reduce((a, r) => a + r.length, 0), tables: Object.keys(data).length };
}

export const backupFileName = (d = new Date()) => `respaldo-inversiones101-${d.toISOString().slice(0, 10)}.json.gz`;

export const blobConfigured = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

/** Guarda un respaldo en Vercel Blob (privado) y borra los más viejos. */
export async function storeBackup(tx: Tx) {
  const { put, list, del } = await import("@vercel/blob");
  const b = await buildBackup(tx);
  const pathname = `${PREFIX}${backupFileName()}`;
  await put(pathname, b.gz, { access: "private", contentType: "application/gzip", addRandomSuffix: false, allowOverwrite: true });
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  const old = blobs.sort((a, z) => z.uploadedAt.getTime() - a.uploadedAt.getTime()).slice(KEEP);
  if (old.length) await del(old.map((x) => x.url));
  return { pathname, ...b, removed: old.length };
}

export async function listBackups() {
  if (!blobConfigured()) return [];
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: PREFIX, limit: 100 });
  return blobs
    .sort((a, z) => z.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map((b) => ({ pathname: b.pathname, name: b.pathname.slice(PREFIX.length), size: b.size, uploadedAt: b.uploadedAt.toISOString() }));
}

export const isBackupPath = (p: string) => p.startsWith(PREFIX) && !p.includes("..");
