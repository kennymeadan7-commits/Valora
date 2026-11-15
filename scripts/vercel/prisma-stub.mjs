/**
 * Remplace `@prisma/client` dans la fonction Vercel : la démo y tourne en
 * `STORAGE=memory`, et embarquer le client Prisma (moteurs natifs compris)
 * alourdirait la fonction pour rien. `STORAGE=prisma` y échoue clairement.
 */
export class PrismaClient {
  constructor() {
    throw new Error(
      "STORAGE=prisma n'est pas disponible dans la fonction Vercel (STORAGE=memory uniquement).",
    );
  }
}
export const Prisma = {};
export default { PrismaClient, Prisma };
