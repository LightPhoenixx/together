-- Extend direct expenses with explicit two-person shares and soft deletion.
ALTER TABLE "DirectExpense"
  ADD COLUMN "createdByShareMinor" BIGINT,
  ADD COLUMN "otherUserShareMinor" BIGINT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "DirectExpense_payerId_otherUserId_occurredAt_idx";
DROP INDEX IF EXISTS "DirectExpense_otherUserId_payerId_occurredAt_idx";
CREATE INDEX "DirectExpense_createdById_otherUserId_occurredAt_idx"
  ON "DirectExpense"("createdById", "otherUserId", "occurredAt");
CREATE INDEX "DirectExpense_otherUserId_createdById_occurredAt_idx"
  ON "DirectExpense"("otherUserId", "createdById", "occurredAt");

CREATE TABLE "DirectSettlement" (
  "id" TEXT NOT NULL,
  "payerId" TEXT NOT NULL,
  "payeeId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "method" "SettlementMethod" NOT NULL DEFAULT 'UPI',
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectSettlement_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DirectSettlement_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DirectSettlement_payerId_payeeId_paidAt_idx"
  ON "DirectSettlement"("payerId", "payeeId", "paidAt");
CREATE INDEX "DirectSettlement_payeeId_payerId_paidAt_idx"
  ON "DirectSettlement"("payeeId", "payerId", "paidAt");
