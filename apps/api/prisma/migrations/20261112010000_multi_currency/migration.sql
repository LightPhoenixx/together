-- Add immutable conversion snapshots so historical balances never change when rates move.
ALTER TABLE "Expense"
  ADD COLUMN "amountBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "exchangeRateMicros" BIGINT NOT NULL DEFAULT 1000000;

ALTER TABLE "ExpensePayer"
  ADD COLUMN "amountBaseMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ExpenseSplit"
  ADD COLUMN "amountBaseMinor" BIGINT NOT NULL DEFAULT 0;

-- Existing expenses were always recorded in the group's base currency.
UPDATE "Expense" SET "amountBaseMinor" = "amountMinor";
UPDATE "ExpensePayer" SET "amountBaseMinor" = "amountMinor";
UPDATE "ExpenseSplit" SET "amountBaseMinor" = "amountMinor";
