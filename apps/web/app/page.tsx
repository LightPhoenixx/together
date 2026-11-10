'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type User = { id: string; displayName: string; email: string };
type Member = { userId: string; user: User };
type Group = { id: string; name: string; currency: string; members: Member[]; _count?: { expenses: number } };
type Expense = {
  id: string;
  description: string;
  category: string;
  amountMinor: number;
  occurredAt: string;
  payers: { user: User; amountMinor: number }[];
  splits: { user: User; amountMinor: number }[];
};
type Balance = { user: User; netAmountMinor: number };
type Settlement = { id: string; payerId: string; payeeId: string; amountMinor: number; method: string; status: string; note?: string | null; paidAt?: string | null; createdAt: string; payer: { id: string; displayName: string }; payee: { id: string; displayName: string } };
type DebtSuggestion = { payer: { id: string; displayName: string }; payee: { id: string; displayName: string }; amountMinor: number };
type ActivityEvent = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; displayName: string };
  afterData?: Record<string, unknown> | null;
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1';
const money = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

export default function Home() {
  const [token, setToken] = useState('');
  const [me, setMe] = useState<User | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  // An empty selected group means the user is on the groups overview.
  const [selected, setSelected] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [suggestions, setSuggestions] = useState<DebtSuggestion[]>([]);
  const [settlementPayer, setSettlementPayer] = useState('');
  const [settlementPayee, setSettlementPayee] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementMethod, setSettlementMethod] = useState('CASH');
  const [settlementNote, setSettlementNote] = useState('');
  const [groupName, setGroupName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('OTHER');
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Something went wrong');
    return data;
  }, [token]);

  const refreshGroups = useCallback(async () => {
    const data = await request('/groups');
    setGroups(data);
  }, [request]);

  const refreshSelected = useCallback(async (id: string) => {
    if (!id) return;
    const [expenseData, balanceData, activityData, settlementData, suggestionData] = await Promise.all([
      request(`/groups/${id}/expenses`),
      request(`/groups/${id}/balances`),
      request(`/groups/${id}/activity`),
      request(`/groups/${id}/settlements`),
      request(`/groups/${id}/settlements/suggestions`),
    ]);
    setExpenses(expenseData);
    setBalances(balanceData);
    setActivity(activityData);
    setSettlements(settlementData);
    setSuggestions(suggestionData);
  }, [request]);

  useEffect(() => {
    const saved = window.localStorage.getItem('together-token');
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    request('/users/me')
      .then((user) => {
        setMe(user);
        return refreshGroups();
      })
      .catch(() => {
        setToken('');
        setMe(null);
        window.localStorage.removeItem('together-token');
      });
  }, [token, request, refreshGroups]);

  useEffect(() => {
    if (!selected || !token) {
      setExpenses([]);
      setBalances([]);
      setActivity([]);
      setSettlements([]);
      setSuggestions([]);
      return;
    }
    setSettlementPayer(me?.id || '');
    setSettlementPayee('');
    refreshSelected(selected).catch((e) => setError(e.message));
  }, [selected, token, refreshSelected, me?.id]);

  async function submitAuth(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await request(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      window.localStorage.setItem('together-token', result.token);
      setToken(result.token);
      setMe(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await request('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName, currency: 'INR' }),
      });
      setGroupName('');
      await refreshGroups();
      // Stay on the overview so the new group appears in the group list.
      setSelected('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError('');
    try {
      await request(`/groups/${selected}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail }),
      });
      setInviteEmail('');
      await refreshGroups();
      await refreshSelected(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    setError('');
    try {
      const existing = expenses.find((item) => item.id === editingExpenseId);
      const payload = {
        description,
        category: expenseCategory,
        amountMinor: Math.round(rupees * 100),
        payerIds: existing ? existing.payers.map((p) => p.user.id) : [me?.id],
        splitUserIds: existing ? existing.splits.map((s) => s.user.id) : groups.find((g) => g.id === selected)?.members.map((m) => m.userId),
        splitMethod: 'EQUAL',
      };
      await request(`/groups/${selected}/expenses${editingExpenseId ? `/${editingExpenseId}` : ''}`, {
        method: editingExpenseId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      setDescription('');
      setAmount('');
      setExpenseCategory('OTHER');
      setEditingExpenseId('');
      await refreshSelected(selected);
      await refreshGroups();
    } catch (e) {
      setError((e as Error).message);
    }
  }


  function editExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setDescription(expense.description);
    setAmount((expense.amountMinor / 100).toFixed(2));
    setExpenseCategory(expense.category || 'OTHER');
    document.getElementById('add-expense')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function deleteExpense(expense: Expense) {
    if (!window.confirm(`Delete “${expense.description}”? This will recalculate group balances.`)) return;
    setError('');
    try {
      await request(`/groups/${selected}/expenses/${expense.id}`, { method: 'DELETE' });
      await refreshSelected(selected);
      await refreshGroups();
    } catch (e) { setError((e as Error).message); }
  }

  async function addSettlement(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const rupees = Number(settlementAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError('Enter a valid settlement amount.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await request('/groups/' + selected + '/settlements', {
        method: 'POST',
        body: JSON.stringify({
          payerId: settlementPayer || me?.id,
          payeeId: settlementPayee,
          amountMinor: Math.round(rupees * 100),
          method: settlementMethod,
          note: settlementNote,
        }),
      });
      setSettlementAmount('');
      setSettlementNote('');
      await refreshSelected(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useSuggestion(suggestion: DebtSuggestion) {
    setSettlementPayer(suggestion.payer.id);
    setSettlementPayee(suggestion.payee.id);
    setSettlementAmount((suggestion.amountMinor / 100).toFixed(2));
  }

  function logout() {
    window.localStorage.removeItem('together-token');
    setToken('');
    setMe(null);
    setGroups([]);
    setSelected('');
  }

  const current = useMemo(() => groups.find((g) => g.id === selected), [groups, selected]);
  const myNet = balances.find((b) => b.user.id === me?.id)?.netAmountMinor || 0;
  const visibleExpenses = expenses.filter((expense) => {
    const term = expenseSearch.trim().toLowerCase();
    const matchesSearch = !term || expense.description.toLowerCase().includes(term) || expense.category.toLowerCase().includes(term) || expense.payers.some((p) => p.user.displayName.toLowerCase().includes(term));
    return matchesSearch && (expenseCategoryFilter === 'ALL' || expense.category === expenseCategoryFilter);
  });
  const totalOwed = Math.max(myNet, 0);
  const totalOwe = Math.max(-myNet, 0);
  const activityDescription = (event: ActivityEvent) => {
    const details = event.afterData || {};
    if (event.action === 'GROUP_CREATED') return 'created this group';
    if (event.action === 'MEMBER_ADDED') return `added ${String(details.displayName || 'a member')} to the group`;
    if (event.action === 'EXPENSE_CREATED') return `added “${String(details.description || 'an expense')}” (${money(Number(details.amountMinor || 0))})`;
    if (event.action === 'EXPENSE_UPDATED') return `updated “${String(details.description || 'an expense')}”`;
    if (event.action === 'EXPENSE_DELETED') return `deleted “${String((event as any).beforeData?.description || 'an expense')}”`;
    if (event.action === 'SETTLEMENT_RECORDED') return `recorded a payment of ${money(Number(details.amountMinor || 0))} from ${String(details.payerName || 'a member')} to ${String(details.payeeName || 'a member')}`;
    return event.action.toLowerCase().replaceAll('_', ' ');
  };
  const dateTime = (value: string) => new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));

  if (!token || !me) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="brand"><span className="brand-mark">t</span><span>Together</span></div>
          <p className="eyebrow">SHARED EXPENSES, MADE SIMPLE</p>
          <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">Track shared spending with the people in your life.</p>
          <form onSubmit={submitAuth} className="stack">
            {mode === 'signup' && (
              <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="e.g. Aditi Sharma" /></label>
            )}
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" /></label>
            {error && <p className="error">{error}</p>}
            <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}</button>
          </form>
          <p className="switch">
            {mode === 'signup' ? 'Already have an account?' : 'New to Together?'}{' '}
            <button className="link-button" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}>
              {mode === 'signup' ? 'Log in' : 'Create an account'}
            </button>
          </p>
          <small className="muted">Milestone 1 development build</small>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">t</span><span>Together</span></div>
        <nav>
          <button className={!selected ? 'active' : ''} onClick={() => setSelected('')}>▦ <span>All groups</span></button>
          <button className={selected ? 'active' : ''} onClick={() => selected ? setSelected(selected) : undefined} disabled={!selected}>◉ <span>Current group</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{me.displayName.slice(0, 1).toUpperCase()}</div>
          <div className="profile"><strong>{me.displayName}</strong><small>{me.email}</small></div>
          <button className="icon-button" onClick={logout} title="Log out">↪</button>
        </div>
      </aside>

      <section className="main">
        {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}

        {!selected ? (
          <>
            <header className="groups-header">
              <div>
                <p className="eyebrow">YOUR TOGETHER SPACE</p>
                <h1>Your groups</h1>
                <p className="muted">Choose a group to see its expenses, balances and members.</p>
              </div>
              <div className="header-user"><span className="avatar">{me.displayName.slice(0, 1).toUpperCase()}</span><span>Hi, {me.displayName.split(' ')[0]}</span></div>
            </header>

            <section className="group-overview-top">
              <div><span className="eyebrow">YOUR CIRCLES</span><h2>All groups <span className="count-pill">{groups.length}</span></h2></div>
              <p className="muted">Your shared spaces, all in one place.</p>
            </section>

            {groups.length ? (
              <div className="group-card-grid">
                {groups.map((g, i) => (
                  <button key={g.id} className="group-card" onClick={() => { setError(''); setSelected(g.id); }}>
                    <div className={`group-card-icon tone-${i % 3}`}>{['⌂', '✈', '☻'][i % 3]}</div>
                    <div className="group-card-main">
                      <div className="group-card-title"><h3>{g.name}</h3><span className="card-arrow">↗</span></div>
                      <p>{g.members.length} {g.members.length === 1 ? 'member' : 'members'} <span>·</span> {g._count?.expenses || 0} expenses</p>
                    </div>
                    <div className="group-card-footer"><span>{g.currency || 'INR'} group</span><strong>View group <span>→</span></strong></div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-groups"><div className="empty-illustration">⌂</div><h3>Your first group starts here</h3><p>Create a group for your flat, a trip, dinners or anything you share.</p></div>
            )}

            <section className="create-group-panel">
              <div className="create-copy"><span className="create-plus">＋</span><div><h3>Create a group</h3><p className="muted">Start sharing expenses with friends, family or flatmates.</p></div></div>
              <form className="create-group-form" onSubmit={createGroup}>
                <input aria-label="New group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Bangalore Flat" required />
                <button className="primary">Create group <span>→</span></button>
              </form>
            </section>
          </>
        ) : (
          <>
            <button className="back-link" onClick={() => { setSelected(''); setError(''); }}>← <span>All groups</span></button>
            <header className="detail-header">
              <div>
                <p className="eyebrow">GROUP WORKSPACE</p>
                <h1>{current?.name || 'Group details'}</h1>
                <p className="muted">Shared expenses and balances for this group.</p>
              </div>
              <span className="group-member-count">{current?.members.length || 0} members</span>
            </header>

            <section className="group-balance-hero">
              <div><span className="hero-label">YOUR NET BALANCE</span><strong>{money(myNet)}</strong><p>{myNet > 0 ? 'You are owed money in this group' : myNet < 0 ? 'You owe money in this group' : 'You are all settled up in this group'}</p></div>
              <div className="hero-breakdown"><div><span>You are owed</span><strong className="hero-positive">{money(totalOwed)}</strong></div><div><span>You owe</span><strong>{money(totalOwe)}</strong></div></div>
            </section>

            <div className="detail-columns">
              <div className="detail-primary-column">
                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Expenses</h2><p className="muted">Search, filter, edit or remove group expenses.</p></div><span className="count-pill">{visibleExpenses.length} / {expenses.length}</span></div>
                  <div className="expense-filters">
                    <input value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} placeholder="Search description or payer…" aria-label="Search expenses" />
                    <select value={expenseCategoryFilter} onChange={(e) => setExpenseCategoryFilter(e.target.value)} aria-label="Filter by category">
                      <option value="ALL">All categories</option>
                      {['FOOD','GROCERIES','TRANSPORT','TRAVEL','RENT','UTILITIES','SHOPPING','ENTERTAINMENT','HEALTH','OTHER'].map((category) => <option key={category} value={category}>{category.replaceAll('_',' ')}</option>)}
                    </select>
                  </div>
                  {visibleExpenses.length ? visibleExpenses.map((expense) => (
                    <div className="detail-expense-row" key={expense.id}>
                      <div className="expense-symbol">₹</div>
                      <div className="detail-expense-copy"><strong>{expense.description}</strong><small>{expense.category.replaceAll('_',' ')} · Paid by {expense.payers.map((payer) => payer.user.displayName).join(', ')}</small><small className="expense-date">{dateTime(expense.occurredAt)}</small></div>
                      <strong className="detail-expense-amount">{money(expense.amountMinor)}</strong>
                      <div className="expense-actions"><button type="button" onClick={() => editExpense(expense)}>Edit</button><button type="button" onClick={() => deleteExpense(expense)}>Delete</button></div>
                    </div>
                  )) : <div className="empty-state"><strong>{expenses.length ? 'No matching expenses' : 'No expenses yet'}</strong><p>{expenses.length ? 'Try another search or category.' : 'Add the first expense for this group below.'}</p></div>}
                </section>


                <section className="panel detail-panel activity-panel">
                  <div className="panel-heading"><div><h2>Group activity</h2><p className="muted">Recent changes in this group.</p></div><span className="count-pill">{activity.length}</span></div>
                  {activity.length ? (
                    <div className="activity-list">
                      {activity.map((event) => (
                        <div className="activity-row" key={event.id}>
                          <span className="activity-dot" />
                          <div className="activity-copy">
                            <strong>{event.actor.displayName}</strong> {activityDescription(event)}
                            <small>{dateTime(event.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="empty-state"><strong>No activity yet</strong><p>Group changes will appear here.</p></div>}
                </section>

                <section className="panel detail-panel" id="add-expense">
                  <div className="panel-heading"><div><h2>{editingExpenseId ? 'Edit expense' : 'Add an expense'}</h2><p className="muted">Paid by you and split equally among selected group members.</p></div><span className="add-expense-symbol">＋</span></div>
                  <form className="expense-form" onSubmit={addExpense}>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for? e.g. Groceries" required />
                    <div className="amount-input"><span>₹</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></div>
                    <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} aria-label="Expense category">
                      {['FOOD','GROCERIES','TRANSPORT','TRAVEL','RENT','UTILITIES','SHOPPING','ENTERTAINMENT','HEALTH','OTHER'].map((category) => <option key={category} value={category}>{category.replaceAll('_',' ')}</option>)}
                    </select>
                    <button className="primary" disabled={!current}>{editingExpenseId ? 'Save changes' : 'Save expense'}</button>
                    {editingExpenseId && <button className="secondary" type="button" onClick={() => { setEditingExpenseId(''); setDescription(''); setAmount(''); setExpenseCategory('OTHER'); }}>Cancel edit</button>}
                  </form>
                </section>
              </div>

              <aside className="detail-side-column">
                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Members</h2><p className="muted">People in this group.</p></div></div>
                  <form className="invite-form" onSubmit={addMember}>
                    <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="friend@example.com" required />
                    <button className="secondary">＋ Add</button>
                  </form>
                  <div className="member-list detail-member-list">
                    {current?.members.map((member) => (
                      <div className="member" key={member.userId}>
                        <span className="avatar small-avatar">{member.user.displayName.slice(0, 1).toUpperCase()}</span>
                        <span>{member.user.displayName}</span>
                        {member.userId === me.id && <small>You</small>}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Group balances</h2><p className="muted">Net amount for each member.</p></div></div>
                  {balances.length ? balances.map((balance) => (
                    <div className="balance-person" key={balance.user.id}>
                      <span>{balance.user.displayName}{balance.user.id === me.id ? ' (you)' : ''}</span>
                      <strong className={balance.netAmountMinor > 0 ? 'green' : balance.netAmountMinor < 0 ? 'red' : ''}>
                        {balance.netAmountMinor === 0 ? 'Settled' : balance.netAmountMinor > 0 ? `Owed ${money(balance.netAmountMinor)}` : `Owes ${money(-balance.netAmountMinor)}`}
                      </strong>
                    </div>
                  )) : <p className="muted balance-empty">No balances to show yet.</p>}

                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Simplify debts</h2><p className="muted">Suggested payments to settle the group.</p></div><span className="count-pill">{suggestions.length}</span></div>
                  {suggestions.length ? suggestions.map((suggestion, index) => (
                    <div className="settlement-suggestion" key={suggestion.payer.id + '-' + suggestion.payee.id + '-' + index}>
                      <div><strong>{suggestion.payer.displayName}</strong><small> pays </small><strong>{suggestion.payee.displayName}</strong><small className="suggestion-amount">{money(suggestion.amountMinor)}</small></div>
                      <button className="secondary" type="button" onClick={() => useSuggestion(suggestion)}>Record</button>
                    </div>
                  )) : <div className="empty-state"><strong>All settled up</strong><p>No payments are currently suggested.</p></div>}
                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Record a payment</h2><p className="muted">Log a payment already made between group members.</p></div></div>
                  <form className="settlement-form" onSubmit={addSettlement}>
                    <label>Paid by<select value={settlementPayer || me.id} onChange={e => { setSettlementPayer(e.target.value); setSettlementPayee(""); }} required>
                      <option value="">Choose member</option>
                      {current?.members.map(m => <option key={m.userId} value={m.userId}>{m.user.displayName}</option>)}
                    </select></label>
                    <label>Paid to<select value={settlementPayee} onChange={e => setSettlementPayee(e.target.value)} required>
                      <option value="">Choose member</option>
                      {current?.members.filter(m => m.userId !== (settlementPayer || me.id)).map(m => <option key={m.userId} value={m.userId}>{m.user.displayName}</option>)}
                    </select></label>
                    <label>Amount (₹)<input type="number" min="0.01" step="0.01" value={settlementAmount} onChange={e => setSettlementAmount(e.target.value)} placeholder="0.00" required /></label>
                    <label>Payment method<select value={settlementMethod} onChange={e => setSettlementMethod(e.target.value)}>
                      <option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option>
                    </select></label>
                    <label>Note (optional)<input value={settlementNote} onChange={e => setSettlementNote(e.target.value)} maxLength={300} placeholder="e.g. Paid via UPI" /></label>
                    <button className="primary" disabled={busy || !settlementPayer || !settlementPayee}>Record payment</button>
                  </form>
                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Settlement history</h2><p className="muted">Payments recorded in this group.</p></div><span className="count-pill">{settlements.length}</span></div>
                  {settlements.length ? settlements.map(settlement => (
                    <div className="settlement-history-row" key={settlement.id}>
                      <div><strong>{settlement.payer.displayName} → {settlement.payee.displayName}</strong><small>{settlement.method.replaceAll('_', ' ')} · {settlement.status} · {settlement.paidAt ? dateTime(settlement.paidAt) : dateTime(settlement.createdAt)}</small>{settlement.note && <small>{settlement.note}</small>}</div>
                      <strong>{money(settlement.amountMinor)}</strong>
                    </div>
                  )) : <div className="empty-state"><strong>No payments recorded</strong><p>Payments will appear here once added.</p></div>}
                </section>
              </aside>
            </div>
          </>
        )}

        <footer>TOGETHER · SHARED EXPENSES, MADE SIMPLE</footer>
      </section>
    </main>
  );
}
