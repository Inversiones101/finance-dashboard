import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { audit, type Tx } from "@/lib/services/ledger";
import { blobConfigured, storeBackup } from "@/lib/services/backup";

/** Vercel Cron (domingos): respaldo semanal en Vercel Blob privado. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  if (!blobConfigured()) return Response.json({ skipped: "Vercel Blob no está conectado" });

  const db = (await getDb()) as unknown as Tx;
  const r = await storeBackup(db);
  await audit(db, null, "backup", "backups", null, { file: r.pathname, rows: r.rows, removed: r.removed });
  return Response.json({ file: r.pathname, rows: r.rows, tables: r.tables, removed: r.removed });
}
