import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { mercuryClient, mercuryConfigured } from "@/lib/mercury/client";
import { accountBalanceCents, audit, type Tx } from "@/lib/services/ledger";
import { escalateOverdue, storeStripeBalance, stripeAccountId } from "@/lib/services/stripe-sync";
import { stripeConfigured, stripeGateway } from "@/lib/stripe/client";
import { syncBank } from "@/lib/services/bank-sync";
import { syncListPrices } from "@/lib/services/pricing";
import { todayIn } from "@/lib/today";

/** Vercel Cron (ver vercel.json), cada mañana: Mercury → bandeja, saldo de Stripe, mora de cuotas y precios programados. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  // Tareas diarias que no dependen del banco: precios programados que entran en vigor hoy.
  await syncListPrices(db as unknown as Tx, todayIn());
  // Contratos en cuotas: pasados los días de gracia, una cuota fallida pasa a vencida.
  await db.transaction(async (t) => escalateOverdue(t as unknown as Tx, todayIn()));
  // Saldo real de Stripe (disponible + pendiente) frente a los libros.
  if (stripeConfigured()) {
    await db.transaction(async (t) => {
      const tx = t as unknown as Tx;
      await storeStripeBalance(tx, stripeGateway(), todayIn(), await accountBalanceCents(tx, await stripeAccountId(tx), todayIn()));
    }).catch((e) => console.error("stripe balance", e instanceof Error ? e.message : e));
  }
  if (!mercuryConfigured()) return Response.json({ skipped: "MERCURY_API_TOKEN no configurado" });

  const r = await db.transaction(async (t) => {
    const tx = t as unknown as Tx;
    const out = await syncBank(tx, mercuryClient(), todayIn());
    await audit(tx, null, "sync_cron", "bank_inbox", null, { added: out.added });
    return out;
  });
  return Response.json({ added: r.added, linked: r.linked, unlinked: r.unlinked });
}
