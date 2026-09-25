import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { mercuryClient, mercuryConfigured } from "@/lib/mercury/client";
import { audit, type Tx } from "@/lib/services/ledger";
import { syncBank } from "@/lib/services/bank-sync";
import { syncListPrices } from "@/lib/services/pricing";
import { todayIn } from "@/lib/today";

/** Vercel Cron (ver vercel.json): sincroniza Mercury cada mañana. Solo llena la bandeja; no clasifica. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  // Tareas diarias que no dependen del banco: precios programados que entran en vigor hoy.
  await syncListPrices(db as unknown as Tx, todayIn());
  if (!mercuryConfigured()) return Response.json({ skipped: "MERCURY_API_TOKEN no configurado" });

  const r = await db.transaction(async (t) => {
    const tx = t as unknown as Tx;
    const out = await syncBank(tx, mercuryClient(), todayIn());
    await audit(tx, null, "sync_cron", "bank_inbox", null, { added: out.added });
    return out;
  });
  return Response.json({ added: r.added, linked: r.linked, unlinked: r.unlinked });
}
