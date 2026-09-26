"use server";

import { z } from "zod";
import { blobConfigured } from "@/lib/services/backup";
import { addAttachment, deleteAttachment } from "@/lib/services/attachments";
import { mutate } from "./mutate";
import { fail, type ActionResult } from "./result";

export async function uploadReceiptAction(form: FormData): Promise<ActionResult> {
  if (!blobConfigured()) return fail("Conecta Vercel Blob para guardar recibos.");
  const expenseId = String(form.get("expenseId") ?? "");
  const file = form.get("file");
  if (!z.string().uuid().safeParse(expenseId).success) return fail("Gasto inválido");
  if (!(file instanceof File) || file.size === 0) return fail("Elige un archivo.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return mutate("expenses", "write", "attachments", "upload", async (tx, userId) => {
    const row = await addAttachment(tx, expenseId, { name: file.name, type: file.type, bytes }, userId);
    return { id: row.id, message: "Recibo guardado", diff: { expenseId, file: file.name } };
  });
}

export async function deleteReceiptAction(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return fail("Registro inválido");
  return mutate("expenses", "write", "attachments", "delete", async (tx) => {
    const row = await deleteAttachment(tx, id);
    return { id, message: "Recibo eliminado", diff: row ? { file: row.fileName } : undefined };
  });
}
