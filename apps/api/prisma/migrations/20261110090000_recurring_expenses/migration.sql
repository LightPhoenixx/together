CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

CREATE TABLE "RecurringExpense" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "notes" TEXT,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "frequency" "RecurrenceFrequency" NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "payerIds" JSONB NOT NULL,
  "splitUserIds" JSONB NOT NULL,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Expense"
  ADD COLUMN "recurringExpenseId" TEXT,
  ADD COLUMN "recurrenceDate" TIMESTAMP(3);

CREATE UNIQUE INDEX "Expense_recurringExpenseId_recurrenceDate_key"
  ON "Expense"("recurringExpenseId", "recurrenceDate");
CREATE INDEX "RecurringExpense_groupId_isActive_nextRunAt_idx"
  ON "RecurringExpense"("groupId", "isActive", "nextRunAt");

ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey"
  FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
