/** Integer minor units: INR amounts are stored as paise. */
export type Money = {
  amountMinor: number;
  currency: string;
};

export type Split = {
  userId: string;
  amountMinor: number;
};

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares';

export type ExpenseDraft = {
  groupId: string;
  description: string;
  paidBy: string[];
  total: Money;
  splits: Split[];
  splitMethod: SplitMethod;
  occurredAt: string;
};

export type Balance = {
  fromUserId: string;
  toUserId: string;
  amount: Money;
};

/** Split integer paise as evenly as possible; remainder paise go to earliest entries. */
export function splitEqually(totalMinor: number, userIds: string[]): Split[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error('totalMinor must be a non-negative safe integer');
  }
  if (userIds.length === 0) throw new Error('At least one participant is required');
  const base = Math.floor(totalMinor / userIds.length);
  const remainder = totalMinor % userIds.length;
  return userIds.map((userId, index) => ({
    userId,
    amountMinor: base + (index < remainder ? 1 : 0),
  }));
}

export function assertSplitTotal(totalMinor: number, splits: Split[]): void {
  const splitTotal = splits.reduce((sum, split) => sum + split.amountMinor, 0);
  if (splitTotal !== totalMinor) {
    throw new Error(`Split total (${splitTotal}) must equal expense total (${totalMinor})`);
  }
}

/** Format integer paise as INR without converting through floating point. */
export function formatINR(amountMinor: number): string {
  const rupees = Math.floor(Math.abs(amountMinor) / 100);
  const paise = Math.abs(amountMinor) % 100;
  const sign = amountMinor < 0 ? '-' : '';
  return `${sign}₹${rupees.toLocaleString('en-IN')}.${String(paise).padStart(2, '0')}`;
}
