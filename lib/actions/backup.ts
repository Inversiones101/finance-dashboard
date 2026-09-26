"use server";

import { revalidatePath } from "next/cache";
import { blobConfigured, storeBackup } from "@/lib/services/backup";
import { mutate } from "./mutate";
import { fail, type ActionResult } from "./result";

/** Respaldo al momento en Vercel Blob (además del automático de los domingos). */
export async function backupNowAction(): Promise<ActionResult> {
  if (!blobConfigured()) return fail("Conecta Vercel Blob para guardar respaldos automáticos.");
  const r = await mutate("users", "admin", "backups", "backup", async (tx) => {
    const b = await storeBackup(tx);
    return { message: `Respaldo guardado: ${b.tables} tablas, ${b.rows.toLocaleString("es")} registros`, diff: { file: b.pathname, rows: b.rows } };
  });
  revalidatePath("/catalogos");
  return r;
}
