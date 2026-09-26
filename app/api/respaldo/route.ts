import { getDb } from "@/db/client";
import { authorize } from "@/lib/auth/session";
import { audit, type Tx } from "@/lib/services/ledger";
import { backupFileName, buildBackup, isBackupPath } from "@/lib/services/backup";

/**
 * Descarga de respaldos (solo Administrador):
 *  - sin parámetros: genera uno al momento;
 *  - ?archivo=respaldos/…: descarga uno de los guardados en Vercel Blob.
 */
export async function GET(req: Request) {
  const { user } = await authorize("users", "admin");
  if (!user) return new Response("No autorizado", { status: 403 });
  const db = (await getDb()) as unknown as Tx;
  const file = new URL(req.url).searchParams.get("archivo");

  if (file) {
    if (!isBackupPath(file)) return new Response("Archivo inválido", { status: 400 });
    const { get } = await import("@vercel/blob");
    const r = await get(file, { access: "private" });
    if (!r?.stream) return new Response("No encontrado", { status: 404 });
    await audit(db, user.id, "download", "backups", null, { file });
    return new Response(r.stream, {
      headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${file.split("/").pop()}"`, "Cache-Control": "no-store" },
    });
  }

  const b = await buildBackup(db);
  await audit(db, user.id, "download", "backups", null, { rows: b.rows });
  return new Response(new Uint8Array(b.gz), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${backupFileName()}"`, "Cache-Control": "no-store" },
  });
}
