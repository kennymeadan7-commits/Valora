import { createHmac, timingSafeEqual } from "node:crypto";

export interface DownloadTokenPayload {
  deliverableId: string;
  /** epoch ms */
  expiresAt: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Jeton de téléchargement signé, à durée courte.
 * Format : `<payload-b64url>.<hmac-sha256-b64url>` — le client ne peut ni
 * allonger la durée ni changer le livrable visé.
 */
export function signDownloadToken(
  payload: DownloadTokenPayload,
  secret: string,
): string {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyDownloadToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): DownloadTokenPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.deliverableId !== "string") return null;
  if (typeof payload.expiresAt !== "number") return null;
  if (payload.expiresAt <= now.getTime()) return null;

  return payload;
}
