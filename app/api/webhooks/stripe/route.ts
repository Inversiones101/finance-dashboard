import { getDb } from "@/db/client";
import { stripeGateway, verifyWebhook } from "@/lib/stripe/client";
import { audit, type Tx } from "@/lib/services/ledger";
import { handleStripeEvent } from "@/lib/services/stripe-sync";
import { todayIn } from "@/lib/today";

/**
 * Webhook de Stripe. Solo acepta eventos con firma válida (STRIPE_WEBHOOK_SECRET) y procesa cada
 * uno dentro de una transacción: si algo falla, responde 500 y Stripe lo reintenta; si ya se
 * procesó, lo ignora. No acepta sesión ni datos del navegador.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get("stripe-signature"));
  } catch {
    return new Response("Firma inválida", { status: 400 });
  }
  try {
    const db = await getDb();
    const result = await db.transaction(async (t) => {
      const tx = t as unknown as Tx;
      const r = await handleStripeEvent(tx, event, stripeGateway(), todayIn());
      if (r.kind !== "duplicate" && r.kind !== "ignored") await audit(tx, null, "stripe_event", "stripe_events", null, { id: event.id, type: event.type, result: r.kind });
      return r;
    });
    return Response.json({ received: true, result: result.kind });
  } catch (e) {
    console.error("stripe webhook", event.type, event.id, e instanceof Error ? e.message : e);
    return new Response("Error al procesar", { status: 500 });
  }
}
