CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

ALTER TABLE "Friendship"
  ADD COLUMN "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING';
CREATE INDEX "Friendship_status_addresseeId_idx" ON "Friendship"("status", "addresseeId");

CREATE TABLE "DirectExpense" (
  "id" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "payerId" TEXT NOT NULL,
  "otherUserId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DirectExpense_payerId_otherUserId_occurredAt_idx"
  ON "DirectExpense"("payerId", "otherUserId", "occurredAt");
CREATE INDEX "DirectExpense_otherUserId_payerId_occurredAt_idx"
  ON "DirectExpense"("otherUserId", "payerId", "occurredAt");

ALTER TABLE "DirectExpense" ADD CONSTRAINT "DirectExpense_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectExpense" ADD CONSTRAINT "DirectExpense_payerId_fkey"
  FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectExpense" ADD CONSTRAINT "DirectExpense_otherUserId_fkey"
  FOREIGN KEY ("otherUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
