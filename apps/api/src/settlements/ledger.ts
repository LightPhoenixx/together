export type LedgerExpense = {
  payers: { userId: string; amountMinor: bigint }[];
  splits: { userId: string; amountMinor: bigint }[];
};
export type LedgerSettlement = {
  payerId: string;
  payeeId: string;
  amountMinor: bigint;
};

export function buildNetBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const net = new Map<string, number>();
  for (const expense of expenses) {
    for (const payer of expense.payers) net.set(payer.userId, (net.get(payer.userId) || 0) + Number(payer.amountMinor));
    for (const split of expense.splits) net.set(split.userId, (net.get(split.userId) || 0) - Number(split.amountMinor));
  }
  for (const settlement of settlements) {
    const amount = Number(settlement.amountMinor);
    // A payment from a debtor to a creditor reduces both outstanding positions.
    net.set(settlement.payerId, (net.get(settlement.payerId) || 0) + amount);
    net.set(settlement.payeeId, (net.get(settlement.payeeId) || 0) - amount);
  }
  return net;
}

export function simplifyNetBalances(
  balances: { user: { id: string; displayName: string }; netAmountMinor: number }[],
) {
  const debtors = balances
    .filter((balance) => balance.netAmountMinor < 0)
    .map((balance) => ({ user: balance.user, remaining: -balance.netAmountMinor }))
    .sort((a, b) => b.remaining - a.remaining);
  const creditors = balances
    .filter((balance) => balance.netAmountMinor > 0)
    .map((balance) => ({ user: balance.user, remaining: balance.netAmountMinor }))
    .sort((a, b) => b.remaining - a.remaining);

  const suggestions: { payer: { id: string; displayName: string }; payee: { id: string; displayName: string }; amountMinor: number }[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.remaining, creditor.remaining);
    if (amountMinor > 0) suggestions.push({ payer: debtor.user, payee: creditor.user, amountMinor });
    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;
    if (debtor.remaining === 0) debtorIndex++;
    if (creditor.remaining === 0) creditorIndex++;
  }
  return suggestions;
}
