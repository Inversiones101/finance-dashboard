/**
 * Cliente de Stripe del servidor. La clave secreta (`STRIPE_SECRET_KEY`) y el secreto del
 * webhook (`STRIPE_WEBHOOK_SECRET`) viven solo en Vercel; nunca llegan al navegador ni a la base.
 * No se guardan datos de tarjeta: solo ids de Stripe (cus_, sub_, in_, ch_, po_).
 *
 * `StripeGateway` es la parte que el sincronizador necesita; en las pruebas se usa uno falso.
 */
import Stripe from "stripe";

export interface StripeGateway {
  /** Cobro y comisión exacta (del balance transaction) de una factura pagada. */
  chargeForInvoice(invoiceId: string): Promise<{ chargeId: string; feeCents: number } | null>;
  balance(): Promise<{ availableCents: number; pendingCents: number }>;
  /** Para importar el historial: facturas pagadas y payouts desde una fecha (segundos Unix). */
  paidInvoices(sinceUnix: number): AsyncIterable<Stripe.Invoice>;
  payouts(sinceUnix: number): AsyncIterable<Stripe.Payout>;
  /** Programa el fin de una suscripción en cuotas (solo si STRIPE_LIMIT_INSTALLMENTS=1). */
  cancelSubscriptionAt(subscriptionId: string, cancelAtUnix: number): Promise<void>;
}

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
export const webhookConfigured = () => !!process.env.STRIPE_WEBHOOK_SECRET;
/** Escribir en la cuenta de Stripe es opt-in: por defecto el sistema solo lee. */
export const installmentLimitEnabled = () => process.env.STRIPE_LIMIT_INSTALLMENTS === "1";

let sdk: Stripe | null = null;
export function stripeSdk() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Falta STRIPE_SECRET_KEY en Vercel.");
  sdk ??= new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "Inversiones 101 Finanzas" } });
  return sdk;
}

const usd = (list: { amount: number; currency: string }[]) => list.filter((x) => x.currency === "usd").reduce((a, x) => a + x.amount, 0);

export function stripeGateway(): StripeGateway {
  const s = stripeSdk();
  return {
    async chargeForInvoice(invoiceId) {
      const payments = await s.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 5 });
      const pay = payments.data[0]?.payment;
      let chargeId = typeof pay?.charge === "string" ? pay.charge : (pay?.charge?.id ?? null);
      if (!chargeId && pay?.payment_intent) {
        const piId = typeof pay.payment_intent === "string" ? pay.payment_intent : pay.payment_intent.id;
        const pi = await s.paymentIntents.retrieve(piId);
        chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);
      }
      if (!chargeId) return null;
      const charge = await s.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const bt = charge.balance_transaction;
      return { chargeId, feeCents: bt && typeof bt !== "string" ? bt.fee : 0 };
    },
    async balance() {
      const b = await s.balance.retrieve();
      return { availableCents: usd(b.available), pendingCents: usd(b.pending) };
    },
    async *paidInvoices(sinceUnix) {
      for await (const inv of s.invoices.list({ status: "paid", created: { gte: sinceUnix }, limit: 100 })) yield inv;
    },
    async *payouts(sinceUnix) {
      for await (const p of s.payouts.list({ created: { gte: sinceUnix }, limit: 100 })) yield p;
    },
    async cancelSubscriptionAt(subscriptionId, cancelAtUnix) {
      await s.subscriptions.update(subscriptionId, { cancel_at: cancelAtUnix, proration_behavior: "none" });
    },
  };
}

/** Verifica la firma del webhook con el cuerpo crudo. Si no es de Stripe, lanza error. */
export function verifyWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Falta STRIPE_WEBHOOK_SECRET");
  if (!signature) throw new Error("Falta la firma de Stripe");
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}
