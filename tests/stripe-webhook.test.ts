import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { verifyWebhook } from "@/lib/stripe/client";

const secret = "whsec_test_secret";
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", livemode: false, data: { object: {} } });

describe("webhook de Stripe", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("acepta solo eventos firmados con el secreto del webhook", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyWebhook(payload, header).id).toBe("evt_1");
    // Cuerpo alterado, firma de otro secreto o sin firma: rechazado.
    expect(() => verifyWebhook(payload.replace("evt_1", "evt_2"), header)).toThrow();
    expect(() => verifyWebhook(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_otro" }))).toThrow();
    expect(() => verifyWebhook(payload, null)).toThrow(/firma/);
  });

  it("sin secreto configurado no procesa nada", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => verifyWebhook(payload, "t=1,v1=x")).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
