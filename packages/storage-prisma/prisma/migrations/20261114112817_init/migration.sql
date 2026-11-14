-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "paymentId" TEXT,
    "paymentUrl" TEXT,
    "regenerations" INTEGER NOT NULL,
    "maxRegenerations" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "cause" TEXT NOT NULL,
    "eventId" TEXT,
    "paymentId" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deliverable_paymentId_key" ON "Deliverable"("paymentId");

-- CreateIndex
CREATE INDEX "JournalEntry_deliverableId_idx" ON "JournalEntry"("deliverableId");
