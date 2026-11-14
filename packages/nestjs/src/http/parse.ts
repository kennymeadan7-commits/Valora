import { BadRequestException } from "@nestjs/common";
import type { CreateDeliverableInput, PayInput } from "@previewpay/core";

/**
 * Validation d'entrée volontairement minimale : on rejette tôt ce qui n'a pas
 * de sens, et on laisse au cœur toutes les décisions métier (prix, état,
 * transitions).
 */

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestException(
      "Le corps de la requête doit être un objet JSON",
    );
  }
  return body as Record<string, unknown>;
}

function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestException(
      `Le champ « ${field} » est requis et doit être une chaîne non vide`,
    );
  }
  return value.trim();
}

export function parseCreateInput(body: unknown): CreateDeliverableInput {
  const obj = asObject(body);
  const type = requireString(obj, "type");

  if (!("content" in obj) || obj["content"] === undefined || obj["content"] === null) {
    throw new BadRequestException("Le champ « content » est requis");
  }

  const maxRegenerations = obj["maxRegenerations"];
  if (maxRegenerations !== undefined) {
    if (
      typeof maxRegenerations !== "number" ||
      !Number.isInteger(maxRegenerations) ||
      maxRegenerations < 0
    ) {
      throw new BadRequestException(
        "Le champ « maxRegenerations » doit être un entier positif ou nul",
      );
    }
  }

  return {
    type,
    content: obj["content"],
    ...(maxRegenerations !== undefined ? { maxRegenerations } : {}),
  };
}

export function parsePayInput(body: unknown): PayInput {
  const obj = asObject(body);
  return {
    phone: requireString(obj, "phone"),
    operator: requireString(obj, "operator"),
  };
}

export function parseRejectInput(body: unknown): { reason: string } {
  const obj = asObject(body);
  return { reason: requireString(obj, "reason") };
}
