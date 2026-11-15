import "reflect-metadata";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

/**
 * Entrée Vercel : la même app Nest que `main.ts`, exposée comme fonction
 * Node au lieu d'un serveur qui écoute un port. Vercel sert lui-même la page
 * produit et la démo React ; cette fonction ne reçoit que `/deliverables`,
 * `/demo` et `/webhooks` (voir `scripts/build-vercel.mjs`).
 *
 * L'app est créée une fois par instance : avec `STORAGE=memory`, l'état de la
 * démo vit tant que l'instance reste chaude (Fluid compute la réutilise).
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let ready: Promise<Handler> | undefined;

async function createHandler(): Promise<Handler> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: ["error", "warn"],
  });
  await app.init();
  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  ready ??= createHandler();
  const express = await ready;
  express(req, res);
}
