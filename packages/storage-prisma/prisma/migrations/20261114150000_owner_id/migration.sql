-- Limite d'aperçus par utilisateur : propriétaire du livrable + index de comptage.
ALTER TABLE "Deliverable" ADD COLUMN "ownerId" TEXT;

CREATE INDEX "Deliverable_ownerId_createdAt_idx" ON "Deliverable"("ownerId", "createdAt");
