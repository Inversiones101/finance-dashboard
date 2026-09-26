import { getDb } from "@/db/client";
import { authorize } from "@/lib/auth/session";
import { getUsdHnlRate } from "@/lib/fx";
import { audit, type Tx } from "@/lib/services/ledger";
import { blobConfigured } from "@/lib/services/backup";
import { buildAccountantPackage, readBlobBytes } from "@/lib/services/accountant-package";

// Con muchos recibos puede tardar; Vercel permite hasta 60 s en el plan gratuito.
export const maxDuration = 60;

/** ZIP para el contador: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por defecto, el año en curso). */
export async function GET(req: Request) {
  const { user } = await authorize("reports", "read");
  if (!user) return new Response("No autorizado", { status: 403 });
  const q = new URL(req.url).searchParams;
  const year = new Date().getFullYear();
  const from = q.get("desde") ?? `${year}-01-01`;
  const to = q.get("hasta") ?? `${year}-12-31`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return new Response("Fechas inválidas", { status: 400 });

  const db = (await getDb()) as unknown as Tx;
  const fx = await getUsdHnlRate();
  const r = await buildAccountantPackage(db, { from, to, hnlPerUsd: fx.hnlPerUsd, readBlob: blobConfigured() ? readBlobBytes : undefined });
  await audit(db, user.id, "download", "accountant_package", null, { from, to, receipts: r.receipts });
  return new Response(new Uint8Array(r.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="inversiones101-contador-${from}_${to}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
