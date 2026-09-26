/**
 * Recibos y facturas de los gastos. El archivo vive en Vercel Blob **privado**; la base guarda
 * solo la referencia. Se sirven por /api/adjuntos/[id] después de verificar permisos.
 */
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Tx } from "./ledger";

export const MAX_BYTES = 4 * 1024 * 1024;
export const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const safeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(-80) || "recibo";

export async function addAttachment(tx: Tx, expenseId: string, file: { name: string; type: string; bytes: Uint8Array }, userId: string | null) {
  if (!ALLOWED.has(file.type)) throw new Error("Sube un PDF o una imagen (JPG, PNG, WEBP, HEIC).");
  if (file.bytes.byteLength > MAX_BYTES) throw new Error("El archivo pasa de 4 MB.");
  const [exp] = await tx.select({ id: s.expenses.id }).from(s.expenses).where(eq(s.expenses.id, expenseId));
  if (!exp) throw new Error("El gasto no existe.");
  const { put } = await import("@vercel/blob");
  const blob = await put(`recibos/${expenseId}/${crypto.randomUUID()}-${safeName(file.name)}`, Buffer.from(file.bytes), {
    access: "private",
    contentType: file.type,
    addRandomSuffix: false,
  });
  const [row] = await tx
    .insert(s.expenseAttachments)
    .values({ expenseId, blobPath: blob.pathname, fileName: file.name.slice(0, 200), contentType: file.type, sizeBytes: file.bytes.byteLength, uploadedBy: userId })
    .returning();
  return row;
}

export async function deleteAttachment(tx: Tx, id: string) {
  const [row] = await tx.delete(s.expenseAttachments).where(eq(s.expenseAttachments.id, id)).returning();
  if (!row) return null;
  const { del } = await import("@vercel/blob");
  await del(row.blobPath).catch(() => undefined); // si el archivo ya no existe, basta con quitar la referencia
  return row;
}

export async function readAttachment(blobPath: string) {
  const { get } = await import("@vercel/blob");
  const r = await get(blobPath, { access: "private" });
  return r?.stream ?? null;
}
