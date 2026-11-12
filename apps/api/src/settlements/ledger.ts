export type LedgerExpense = {
  payers: { userId: string; amountMinor: bigint; amountBaseMinor?: bigint }[];
  splits: { userId: string; amountMinor: bigint; amountBaseMinor?: bigint }[];
};
export type LedgerSettlement = {
  payerId: string;
  payeeId: string;
  amountMinor: bigint;
};

export function buildNetBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const net = new Map<string, number>();
  for (const expense of expenses) {
    for (const payer of expense.payers) net.set(payer.userId, (net.get(payer.userId) || 0) + Number(payer.amountBaseMinor ?? payer.amountMinor));
    for (const split of expense.splits) net.set(split.userId, (net.get(split.userId) || 0) - Number(split.amountBaseMinor ?? split.amountMinor));
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
  const people = balances.filter((balance) => balance.netAmountMinor !== 0);
  const makeTransfers = (group: typeof people) => {
    const debtors = group
      .filter((balance) => balance.netAmountMinor < 0)
      .map((balance) => ({ user: balance.user, remaining: -balance.netAmountMinor }))
      .sort((a, b) => b.remaining - a.remaining);
    const creditors = group
      .filter((balance) => balance.netAmountMinor > 0)
      .map((balance) => ({ user: balance.user, remaining: balance.netAmountMinor }))
      .sort((a, b) => b.remaining - a.remaining);
    const transfers: { payer: { id: string; displayName: string }; payee: { id: string; displayName: string }; amountMinor: number }[] = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];
      const amountMinor = Math.min(debtor.remaining, creditor.remaining);
      if (amountMinor > 0) transfers.push({ payer: debtor.user, payee: creditor.user, amountMinor });
      debtor.remaining -= amountMinor;
      creditor.remaining -= amountMinor;
      if (debtor.remaining === 0) debtorIndex++;
      if (creditor.remaining === 0) creditorIndex++;
    }
    return transfers;
  };

  const total = people.reduce((sum, person) => sum + person.netAmountMinor, 0);
  // Exact minimum-transfer partitioning is practical for typical small groups.
  // For unusually large groups, use the same deterministic greedy fallback.
  if (people.length > 16 || total !== 0) return makeTransfers(people);
  if (people.length === 0) return [];

  const size = 1 << people.length;
  const subsetSums = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    const index = 31 - Math.clz32(bit);
    subsetSums[mask] = subsetSums[mask ^ bit] + people[index].netAmountMinor;
  }

  const best = new Int16Array(size);
  best.fill(-1);
  const choice = new Int32Array(size);
  best[0] = 0;

  const solve = (mask: number): number => {
    if (best[mask] >= 0) return best[mask];
    const firstBit = mask & -mask;
    let bestCount = -1;
    let bestSubset = 0;
    for (let subset = mask; subset > 0; subset = (subset - 1) & mask) {
      if ((subset & firstBit) === 0 || subsetSums[subset] !== 0) continue;
      const candidate = 1 + solve(mask ^ subset);
      if (candidate > bestCount) {
        bestCount = candidate;
        bestSubset = subset;
      }
    }
    best[mask] = bestCount;
    choice[mask] = bestSubset;
    return bestCount;
  };

  let remainingMask = size - 1;
  solve(remainingMask);
  const transfers: ReturnType<typeof makeTransfers> = [];
  while (remainingMask) {
    const subset = choice[remainingMask];
    const group = people.filter((_, index) => (subset & (1 << index)) !== 0);
    transfers.push(...makeTransfers(group));
    remainingMask ^= subset;
  }
  return transfers;
}
