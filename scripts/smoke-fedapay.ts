/**
 * Vérification manuelle contre la sandbox FedaPay.
 *
 *   node --env-file=.env scripts/smoke-fedapay.ts
 *
 * Crée une vraie transaction sandbox (200 XOF), puis relit l'événement
 * `transaction.created` reçu sur webhook.site pour vérifier que notre
 * implémentation de signature accepte une signature FedaPay réelle.
 */
import { FedaPayProvider } from "@previewpay/provider-fedapay";

const secretKey = process.env.FEDAPAY_SECRET_KEY;
const webhookSecret = process.env.FEDAPAY_WEBHOOK_SECRET;
const hookUrl = process.env.FEDAPAY_CALLBACK_URL;
if (!secretKey || !webhookSecret || !hookUrl) {
  throw new Error("FEDAPAY_SECRET_KEY / FEDAPAY_WEBHOOK_SECRET / FEDAPAY_CALLBACK_URL requis");
}

const provider = new FedaPayProvider({
  secretKey,
  webhookSecret,
  environment: "sandbox",
  callbackUrl: hookUrl,
});

const created = await provider.createPayment({
  amount: 200,
  currency: "XOF",
  phone: "+22990000000",
  operator: "mtn_benin",
  reference: `smoke-${Date.now()}`,
});

console.log("1. transaction créée :", created.paymentId);
console.log("   page de paiement :", created.paymentUrl);
console.log("2. statut API        :", await provider.getPaymentStatus(created.paymentId));

// Récupère l'événement réellement livré par FedaPay sur webhook.site.
const token = new URL(hookUrl).pathname.replace("/", "");
await new Promise((r) => setTimeout(r, 4000));
const res = await fetch(`https://webhook.site/token/${token}/requests?sorting=newest`);
const payload = (await res.json()) as {
  data: Array<{
    content: string;
    headers: Record<string, string[]>;
  }>;
};

const hook = payload.data[0];
if (!hook) throw new Error("aucun webhook reçu");

const rawBody = Buffer.from(hook.content);
const signature = hook.headers["x-fedapay-signature"]?.[0] ?? "";
const t = Number(new URLSearchParams(signature.replace(",", "&")).get("t"));

const checker = new FedaPayProvider({
  secretKey,
  webhookSecret,
  environment: "sandbox",
  // On rejoue l'horodatage d'origine pour ne pas buter sur la tolérance.
  nowSeconds: () => t,
});

const event = await checker.parseWebhook(rawBody, { "x-fedapay-signature": signature });
console.log("3. signature vérifiée :", event.type, "→ transaction", event.paymentId, "| eventId", event.eventId);

const forged = await checker
  .parseWebhook(Buffer.from(hook.content.replace("200", "999")), {
    "x-fedapay-signature": signature,
  })
  .then(() => "ACCEPTÉ (anormal)")
  .catch(() => "rejeté (attendu)");
console.log("4. corps altéré       :", forged);
