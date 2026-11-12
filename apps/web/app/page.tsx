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
  amountBaseMinor: number;
  currency: string;
  exchangeRate: number;
  occurredAt: string;
  payers: { user: User; amountMinor: number; amountBaseMinor: number }[];
  splits: { user: User; amountMinor: number }[];
};
type Balance = { user: User; netAmountMinor: number };
type DuplicateExpense = { id: string; description: string; amountMinor: number; currency: string; occurredAt: string };
type Settlement = { id: string; payerId: string; payeeId: string; amountMinor: number; method: string; status: string; note?: string | null; paidAt?: string | null; createdAt: string; payer: { id: string; displayName: string }; payee: { id: string; displayName: string } };
type DebtSuggestion = { payer: { id: string; displayName: string }; payee: { id: string; displayName: string }; amountMinor: number };
type Friend = { id: string; displayName: string; email: string };
type FriendRequest = { id: string; user: Friend; createdAt: string };
type FriendBalance = { friend: Friend; netAmountMinor: number };
type DirectExpense = { id: string; description: string; amountMinor: number; occurredAt: string; payerId: string; createdById: string; createdByShareMinor: number; otherUserShareMinor: number; deletedAt?: string | null; payer: Friend };
type FriendSettlement = { id: string; payerId: string; payeeId: string; amountMinor: number; method: string; note?: string | null; paidAt: string; payer: Friend; payee: Friend };
type FriendActivity = { id: string; action: string; createdAt: string; actor: { id: string; displayName: string }; afterData?: Record<string, unknown> | null };
type AppNotification = { id: string; type: string; title: string; message: string; readAt: string | null; createdAt: string; actor?: { id: string; displayName: string } | null };
type ActivityEvent = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; displayName: string };
  afterData?: Record<string, unknown> | null;
  beforeData?: Record<string, unknown> | null;
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1';
const money = (minor: number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);

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
  const [deletedExpenses, setDeletedExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showAllDeletedExpenses, setShowAllDeletedExpenses] = useState(false);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [suggestions, setSuggestions] = useState<DebtSuggestion[]>([]);
  const [settlementPayer, setSettlementPayer] = useState('');
  const [settlementPayee, setSettlementPayee] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementMethod, setSettlementMethod] = useState('CASH');
  const [settlementNote, setSettlementNote] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCurrency, setGroupCurrency] = useState('INR');
  const [expenseCurrency, setExpenseCurrency] = useState('INR');
  const [expenseExchangeRate, setExpenseExchangeRate] = useState('1');
  const [inviteEmail, setInviteEmail] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('OTHER');
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('ALL');
  const [expenseFromDate, setExpenseFromDate] = useState('');
  const [expenseToDate, setExpenseToDate] = useState('');
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateExpense[]>([]);
  const [pendingExpensePayload, setPendingExpensePayload] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [view, setView] = useState<'groups' | 'friends'>('groups');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>({ incoming: [], outgoing: [] });
  const [friendBalances, setFriendBalances] = useState<FriendBalance[]>([]);
  const [friendEmail, setFriendEmail] = useState('');
  const [activeFriend, setActiveFriend] = useState<Friend | null>(null);
  const [directExpenses, setDirectExpenses] = useState<DirectExpense[]>([]);
  const [directDescription, setDirectDescription] = useState('');
  const [directAmount, setDirectAmount] = useState('');
  const [directPayer, setDirectPayer] = useState('me');
  const [directMyShare, setDirectMyShare] = useState('');
  const [editingDirectExpenseId, setEditingDirectExpenseId] = useState('');
  const [friendSettlements, setFriendSettlements] = useState<FriendSettlement[]>([]);
  const [friendActivity, setFriendActivity] = useState<FriendActivity[]>([]);
  const [directSettlementAmount, setDirectSettlementAmount] = useState('');
  const [directSettlementPayer, setDirectSettlementPayer] = useState('me');
  const [directSettlementMethod, setDirectSettlementMethod] = useState('UPI');
  const [directSettlementNote, setDirectSettlementNote] = useState('');

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

  const refreshFriends = useCallback(async () => {
    const [friendData, requestData, balanceData] = await Promise.all([request('/friends'), request('/friends/requests'), request('/friends/balances')]);
    setFriends(friendData.map((item: any) => item.friend));
    setFriendRequests(requestData);
    setFriendBalances(balanceData);
  }, [request]);

  const refreshSelected = useCallback(async (id: string) => {
    if (!id) return;
    const [expenseData, deletedExpenseData, balanceData, activityData, settlementData, suggestionData] = await Promise.all([
      request(`/groups/${id}/expenses`),
      request(`/groups/${id}/expenses/deleted`),
      request(`/groups/${id}/balances`),
      request(`/groups/${id}/activity`),
      request(`/groups/${id}/settlements`),
      request(`/groups/${id}/settlements/suggestions`),
    ]);
    setExpenses(expenseData);
    setDeletedExpenses(deletedExpenseData);
    setBalances(balanceData);
    setActivity(activityData);
    setShowAllActivity(false);
    setShowAllExpenses(false);
    setShowAllDeletedExpenses(false);
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
      .then(async (user) => {
        setMe(user);
        await refreshGroups();
        await refreshFriends();
        const notificationData = await request('/notifications');
        setNotifications(notificationData.items || []);
        setUnreadNotifications(notificationData.unreadCount || 0);
      })
      .catch(() => {
        setToken('');
        setMe(null);
        window.localStorage.removeItem('together-token');
      });
  }, [token, request, refreshGroups, refreshFriends]);

  useEffect(() => {
    if (!selected || !token) {
      setExpenses([]);
      setDeletedExpenses([]);
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

  async function sendSettlementReminder(recipientId: string) {
    if (!selected) return;
    try { await request('/notifications/remind', { method: 'POST', body: JSON.stringify({ groupId: selected, recipientId }) }); await refreshNotifications(); setError('Reminder sent.'); }
    catch (e) { setError((e as Error).message); }
  }

  async function refreshNotifications() {
    const data = await request('/notifications');
    setNotifications(data.items || []);
    setUnreadNotifications(data.unreadCount || 0);
  }

  async function markNotificationRead(id: string) {
    try { await request(`/notifications/${id}/read`, { method: 'POST' }); await refreshNotifications(); }
    catch (e) { setError((e as Error).message); }
  }

  async function markAllNotificationsRead() {
    try { await request('/notifications/read-all', { method: 'POST' }); await refreshNotifications(); }
    catch (e) { setError((e as Error).message); }
  }

  async function sendFriendRequest(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await request('/friends/requests', { method: 'POST', body: JSON.stringify({ email: friendEmail }) }); setFriendEmail(''); await refreshFriends(); }
    catch (e) { setError((e as Error).message); }
  }

  async function acceptFriendRequest(id: string) {
    try { await request(`/friends/requests/${id}/accept`, { method: 'POST' }); await refreshFriends(); }
    catch (e) { setError((e as Error).message); }
  }

  async function declineFriendRequest(id: string) {
    try { await request(`/friends/requests/${id}`, { method: 'DELETE' }); await refreshFriends(); }
    catch (e) { setError((e as Error).message); }
  }

  async function openFriend(friend: Friend) {
    setActiveFriend(friend);
    try {
      const [expenseRows, settlementRows, activityRows] = await Promise.all([
        request(`/friends/${friend.id}/expenses`),
        request(`/friends/${friend.id}/settlements`),
        request(`/friends/${friend.id}/activity`),
      ]);
      setDirectExpenses(expenseRows); setFriendSettlements(settlementRows); setFriendActivity(activityRows);
    } catch (e) { setError((e as Error).message); }
  }

  async function addDirectExpense(e: FormEvent) {
    e.preventDefault(); if (!activeFriend) return;
    try {
      const amountMinor = Math.round(Number(directAmount) * 100);
      const myShareMinor = directMyShare.trim() ? Math.round(Number(directMyShare) * 100) : undefined;
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('Enter a valid amount.');
      if (myShareMinor !== undefined && (!Number.isSafeInteger(myShareMinor) || myShareMinor < 0 || myShareMinor > amountMinor)) throw new Error('Your share must be between zero and the total.');
      const editing = Boolean(editingDirectExpenseId);
      await request(`/friends/${activeFriend.id}/expenses${editing ? `/${editingDirectExpenseId}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ description: directDescription, amountMinor, myShareMinor, payerId: directPayer === 'me' ? me?.id : activeFriend.id }),
      });
      setDirectDescription(''); setDirectAmount(''); setDirectMyShare(''); setEditingDirectExpenseId('');
      await openFriend(activeFriend); await refreshFriends();
    } catch (e) { setError((e as Error).message); }
  }

  function editDirectExpense(item: DirectExpense) {
    if (!activeFriend || item.createdById !== me?.id) return;
    setEditingDirectExpenseId(item.id); setDirectDescription(item.description);
    setDirectAmount((item.amountMinor / 100).toFixed(2));
    setDirectMyShare((item.createdByShareMinor / 100).toFixed(2));
    setDirectPayer(item.payerId === me?.id ? 'me' : 'friend');
  }

  async function deleteDirectExpense(item: DirectExpense) {
    if (!activeFriend || !window.confirm(`Delete “${item.description}”? This will update your balance.`)) return;
    try {
      await request(`/friends/${activeFriend.id}/expenses/${item.id}`, { method: 'DELETE' });
      await openFriend(activeFriend); await refreshFriends();
    } catch (e) { setError((e as Error).message); }
  }

  async function addDirectSettlement(e: FormEvent) {
    e.preventDefault(); if (!activeFriend) return;
    try {
      const amountMinor = Math.round(Number(directSettlementAmount) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('Enter a valid payment amount.');
      await request(`/friends/${activeFriend.id}/settlements`, { method: 'POST', body: JSON.stringify({
        amountMinor, payerId: directSettlementPayer === 'me' ? me?.id : activeFriend.id,
        method: directSettlementMethod, note: directSettlementNote,
      }) });
      setDirectSettlementAmount(''); setDirectSettlementNote('');
      await openFriend(activeFriend); await refreshFriends();
    } catch (e) { setError((e as Error).message); }
  }

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
        body: JSON.stringify({ name: groupName, currency: groupCurrency }),
      });
      setGroupName(''); setGroupCurrency('INR');
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

  async function submitExpensePayload(payload: any) {
    await request(`/groups/${selected}/expenses${editingExpenseId ? `/${editingExpenseId}` : ''}`, {
      method: editingExpenseId ? 'PUT' : 'POST', body: JSON.stringify(payload),
    });
    setDescription(''); setAmount(''); setExpenseCategory('OTHER'); setEditingExpenseId('');
    setExpenseCurrency(current?.currency || 'INR'); setExpenseExchangeRate('1');
    setDuplicateCandidates([]); setPendingExpensePayload(null);
    await refreshSelected(selected); await refreshGroups();
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) { setError('Enter a valid amount.'); return; }
    setError('');
    try {
      const existing = expenses.find((item) => item.id === editingExpenseId);
      const payload = {
        description, category: expenseCategory, amountMinor: Math.round(rupees * 100), currency: expenseCurrency,
        ...(expenseCurrency !== current?.currency ? { exchangeRate: Number(expenseExchangeRate) } : {}),
        payerIds: existing ? existing.payers.map((p) => p.user.id) : [me?.id],
        splitUserIds: existing ? existing.splits.map((s) => s.user.id) : groups.find((g) => g.id === selected)?.members.map((m) => m.userId),
        splitMethod: 'EQUAL',
      };
      if (!editingExpenseId) {
        const duplicates = await request(`/groups/${selected}/expenses/duplicate-check`, { method: 'POST', body: JSON.stringify(payload) });
        if (duplicates.length) { setDuplicateCandidates(duplicates); setPendingExpensePayload(payload); return; }
      }
      await submitExpensePayload(payload);
    } catch (e) { setError((e as Error).message); }
  }

  function editExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setDescription(expense.description);
    setAmount((expense.amountMinor / 100).toFixed(2));
    setExpenseCategory(expense.category || 'OTHER');
    setExpenseCurrency(expense.currency || current?.currency || 'INR'); setExpenseExchangeRate(String(expense.exchangeRate || 1));
    document.getElementById('add-expense')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function restoreExpense(expense: Expense) {
    setError('');
    try {
      await request(`/groups/${selected}/expenses/${expense.id}/restore`, { method: 'POST' });
      await refreshSelected(selected);
      await refreshGroups();
    } catch (e) { setError((e as Error).message); }
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
  useEffect(() => { if (current && !editingExpenseId) setExpenseCurrency(current.currency || 'INR'); }, [current?.id, current?.currency, editingExpenseId]);
  const myNet = balances.find((b) => b.user.id === me?.id)?.netAmountMinor || 0;
  const visibleExpenses = expenses.filter((expense) => {
    const term = expenseSearch.trim().toLowerCase();
    const matchesSearch = !term || expense.description.toLowerCase().includes(term) || expense.category.toLowerCase().includes(term) || expense.payers.some((p) => p.user.displayName.toLowerCase().includes(term));
    const expenseDate = new Date(expense.occurredAt).toISOString().slice(0, 10);
    const matchesDates = (!expenseFromDate || expenseDate >= expenseFromDate) && (!expenseToDate || expenseDate <= expenseToDate);
    return matchesSearch && matchesDates && (expenseCategoryFilter === 'ALL' || expense.category === expenseCategoryFilter);
  });
  const totalOwed = Math.max(myNet, 0);
  const totalOwe = Math.max(-myNet, 0);
  const analytics = useMemo(() => {
    const total = expenses.reduce((sum, item) => sum + item.amountBaseMinor, 0);
    const categories = Object.entries(expenses.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amountBaseMinor;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]);
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return { key, label: date.toLocaleDateString('en-IN', { month: 'short' }), amount: expenses.filter(item => item.occurredAt.slice(0, 7) === key).reduce((sum, item) => sum + item.amountBaseMinor, 0) };
    });
    const payers = Object.entries(expenses.reduce<Record<string, number>>((acc, item) => {
      item.payers.forEach(payer => { acc[payer.user.displayName] = (acc[payer.user.displayName] || 0) + payer.amountBaseMinor; });
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]);
    return { total, categories, months, payers, maxMonth: Math.max(1, ...months.map(month => month.amount)) };
  }, [expenses]);
  const activityDescription = (event: ActivityEvent) => {
    const details = event.afterData || {};
    if (event.action === 'GROUP_CREATED') return 'created this group';
    if (event.action === 'MEMBER_ADDED') return `added ${String(details.displayName || 'a member')} to the group`;
    if (event.action === 'EXPENSE_CREATED') return `added “${String(details.description || 'an expense')}” (${money(Number(details.amountMinor || 0), String(details.currency || current?.currency || 'INR'))})`;
    if (event.action === 'EXPENSE_UPDATED') return `updated “${String(details.description || 'an expense')}”`;
    if (event.action === 'EXPENSE_DELETED') return `deleted “${String(details.description || event.beforeData?.description || 'an expense')}”`;
    if (event.action === 'EXPENSE_RESTORED') return `restored “${String(details.description || 'an expense')}”`;
    if (event.action === 'SETTLEMENT_RECORDED') return `recorded a payment of ${money(Number(details.amountMinor || 0), current?.currency || 'INR')} from ${String(details.payerName || 'a member')} to ${String(details.payeeName || 'a member')}`;
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
          <button className={view === 'groups' && !selected ? 'active' : ''} onClick={() => { setView('groups'); setSelected(''); setActiveFriend(null); }}>▦ <span>All groups</span></button>
          <button className={view === 'friends' ? 'active' : ''} onClick={() => { setView('friends'); setSelected(''); setActiveFriend(null); refreshFriends().catch(e => setError(e.message)); }}>♧ <span>Friends</span></button>
          <button className={selected ? 'active' : ''} onClick={() => selected ? setSelected(selected) : undefined} disabled={!selected}>◉ <span>Current group</span></button>
          <button className={notificationsOpen ? 'active' : ''} onClick={() => { const next = !notificationsOpen; setNotificationsOpen(next); if (next) refreshNotifications().catch(e => setError(e.message)); }}>♧ <span>Notifications</span>{unreadNotifications > 0 && <b className="notification-count">{unreadNotifications}</b>}</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{me.displayName.slice(0, 1).toUpperCase()}</div>
          <div className="profile"><strong>{me.displayName}</strong><small>{me.email}</small></div>
          <button className="icon-button" onClick={logout} title="Log out">↪</button>
        </div>
      </aside>

      <section className="main">
        {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}
        {notificationsOpen && <section className="panel notification-panel"><div className="panel-heading"><div><h2>Notifications</h2><p className="muted">Updates about your groups and friends.</p></div><button className="secondary" type="button" onClick={markAllNotificationsRead} disabled={!unreadNotifications}>Mark all read</button></div>{notifications.length ? notifications.map(item => <div className={`notification-row ${item.readAt ? 'is-read' : 'is-unread'}`} key={item.id}><div><strong>{item.title}</strong><p>{item.message}</p><small>{dateTime(item.createdAt)}</small></div>{!item.readAt && <button className="link-button" type="button" onClick={() => markNotificationRead(item.id)}>Mark read</button>}</div>) : <p className="muted">You're all caught up.</p>}</section>}

        {view === 'friends' ? (
          <>
            <header className="groups-header"><div><p className="eyebrow">YOUR CONNECTIONS</p><h1>Friends</h1><p className="muted">Add friends and track expenses you share directly.</p></div><div className="header-user"><span className="avatar">{me.displayName.slice(0,1).toUpperCase()}</span><span>{me.displayName}</span></div></header>
            <section className="create-group-panel"><div className="create-copy"><span className="create-plus">＋</span><div><h3>Add a friend</h3><p className="muted">Send a request using their Together account email.</p></div></div><form className="create-group-form" onSubmit={sendFriendRequest}><input type="email" value={friendEmail} onChange={e => setFriendEmail(e.target.value)} placeholder="friend@example.com" required /><button className="primary">Send request</button></form></section>
            {friendRequests.incoming.length > 0 && <section className="panel detail-panel"><h2>Incoming requests</h2>{friendRequests.incoming.map(r => <div className="friend-line" key={r.id}><div><strong>{r.user.displayName}</strong><small>{r.user.email}</small></div><div className="friend-actions"><button className="primary" onClick={() => acceptFriendRequest(r.id)}>Accept</button><button className="secondary" onClick={() => declineFriendRequest(r.id)}>Decline</button></div></div>)}</section>}
            {friendRequests.outgoing.length > 0 && <section className="panel detail-panel"><h2>Sent requests</h2>{friendRequests.outgoing.map(r => <div className="friend-line" key={r.id}><div><strong>{r.user.displayName}</strong><small>{r.user.email} · Pending</small></div></div>)}</section>}
            <section className="group-overview-top"><div><span className="eyebrow">YOUR PEOPLE</span><h2>Friend list <span className="count-pill">{friends.length}</span></h2></div></section>
            <div className="friend-layout"><div className="panel detail-panel friend-list">{friends.length ? friends.map(friend => { const balance = friendBalances.find(b => b.friend.id === friend.id)?.netAmountMinor || 0; return <button className={activeFriend?.id === friend.id ? 'friend-item selected' : 'friend-item'} key={friend.id} onClick={() => openFriend(friend)}><span className="avatar">{friend.displayName.slice(0,1).toUpperCase()}</span><span className="friend-name"><strong>{friend.displayName}</strong><small>{friend.email}</small></span><strong className={balance > 0 ? 'green' : balance < 0 ? 'red' : ''}>{balance > 0 ? `Owes you ${money(balance)}` : balance < 0 ? `You owe ${money(-balance)}` : 'Settled'}</strong></button>; }) : <p className="muted">No friends yet. Send a request to get started.</p>}</div>
              <div className="panel detail-panel friend-detail">{activeFriend ? <>
                <h2>{activeFriend.displayName}</h2>
                <p className="muted">Track expenses, custom splits and payments between you two.</p>
                <form className="friend-expense-form" onSubmit={addDirectExpense}>
                  <label>Description<input value={directDescription} onChange={e => setDirectDescription(e.target.value)} placeholder="What was it for?" required maxLength={120} /></label>
                  <label>Total amount (₹)<input type="number" min="0.01" step="0.01" value={directAmount} onChange={e => setDirectAmount(e.target.value)} placeholder="0.00" required /></label>
                  <label>Paid by<select value={directPayer} onChange={e => setDirectPayer(e.target.value)}><option value="me">Me</option><option value="friend">{activeFriend.displayName}</option></select></label>
                  <label>Your share (₹)<input type="number" min="0" step="0.01" value={directMyShare} onChange={e => setDirectMyShare(e.target.value)} placeholder="Leave blank for equal split" /></label>
                  <button className="primary">{editingDirectExpenseId ? 'Save changes' : 'Add expense'}</button>
                  {editingDirectExpenseId && <button type="button" className="secondary" onClick={() => { setEditingDirectExpenseId(''); setDirectDescription(''); setDirectAmount(''); setDirectMyShare(''); }}>Cancel edit</button>}
                </form>
                <h3>Expense history</h3>
                {directExpenses.filter(item => !item.deletedAt).map(item => <div className="friend-line" key={item.id}>
                  <div><strong>{item.description}</strong><small>{dateTime(item.occurredAt)} · Paid by {item.payerId === me.id ? 'you' : activeFriend.displayName} · Split: {money(item.createdById === me.id ? item.createdByShareMinor : item.otherUserShareMinor)} you / {money(item.createdById === me.id ? item.otherUserShareMinor : item.createdByShareMinor)} friend</small></div>
                  <strong>{money(item.amountMinor)}</strong>
                  {item.createdById === me.id && <div className="friend-actions"><button className="secondary" type="button" onClick={() => editDirectExpense(item)}>Edit</button><button className="danger-text" type="button" onClick={() => deleteDirectExpense(item)}>Delete</button></div>}
                </div>)}
                {!directExpenses.some(item => !item.deletedAt) && <p className="muted">No direct expenses yet.</p>}
                <h3>Record a payment</h3>
                <form className="friend-expense-form" onSubmit={addDirectSettlement}>
                  <label>Paid by<select value={directSettlementPayer} onChange={e => setDirectSettlementPayer(e.target.value)}><option value="me">Me</option><option value="friend">{activeFriend.displayName}</option></select></label>
                  <label>Amount (₹)<input type="number" min="0.01" step="0.01" value={directSettlementAmount} onChange={e => setDirectSettlementAmount(e.target.value)} placeholder="0.00" required /></label>
                  <label>Method<select value={directSettlementMethod} onChange={e => setDirectSettlementMethod(e.target.value)}><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
                  <label>Note (optional)<input value={directSettlementNote} onChange={e => setDirectSettlementNote(e.target.value)} placeholder="Payment note" maxLength={300} /></label>
                  <button className="primary">Record payment</button>
                </form>
                <h3>Payment history</h3>
                {friendSettlements.map(item => <div className="friend-line" key={item.id}><div><strong>{item.payerId === me.id ? 'You' : activeFriend.displayName} → {item.payeeId === me.id ? 'you' : activeFriend.displayName}</strong><small>{dateTime(item.paidAt)} · {item.method.replaceAll('_',' ')} {item.note ? '· '+item.note : ''}</small></div><strong>{money(item.amountMinor)}</strong></div>)}
                {!friendSettlements.length && <p className="muted">No payments recorded yet.</p>}
                <h3>Recent activity</h3>
                {friendActivity.map(item => <div className="activity-row" key={item.id}><span className="activity-dot" /><div className="activity-copy"><strong>{item.actor.displayName}</strong> {item.action.toLowerCase().replaceAll('_',' ')}<small>{dateTime(item.createdAt)}</small></div></div>)}
                {!friendActivity.length && <p className="muted">No activity yet.</p>}
              </>  : <div className="empty-state"><strong>Select a friend</strong><p>Choose someone to view or add direct expenses.</p></div>}</div>
            </div>
          </>
        ) : !selected ? (
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
                <select aria-label="Group base currency" value={groupCurrency} onChange={e => setGroupCurrency(e.target.value)}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British Pound</option><option value="AED">AED — UAE Dirham</option><option value="SGD">SGD — Singapore Dollar</option><option value="CAD">CAD — Canadian Dollar</option><option value="AUD">AUD — Australian Dollar</option><option value="JPY">JPY — Japanese Yen</option></select>
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
              <div><span className="hero-label">YOUR NET BALANCE</span><strong>{money(myNet, current?.currency || 'INR')}</strong><p>{myNet > 0 ? 'You are owed money in this group' : myNet < 0 ? 'You owe money in this group' : 'You are all settled up in this group'}</p></div>
              <div className="hero-breakdown"><div><span>You are owed</span><strong className="hero-positive">{money(totalOwed, current?.currency || 'INR')}</strong></div><div><span>You owe</span><strong>{money(totalOwe, current?.currency || 'INR')}</strong></div></div>
            </section>

            <section className="panel detail-panel" style={{ marginBottom: 24 }}>
              <div className="panel-heading"><div><h2>Spending insights</h2><p className="muted">A breakdown of active expenses in this group, shown in {current?.currency || 'INR'}.</p></div><span className="count-pill">{expenses.length} expenses</span></div>
              <div className="insights-summary">
                <div><span className="muted">Total group spending</span><strong>{money(analytics.total, current?.currency || 'INR')}</strong></div>
                <div><span className="muted">Average per expense</span><strong>{money(expenses.length ? Math.round(analytics.total / expenses.length) : 0, current?.currency || 'INR')}</strong></div>
                <div><span className="muted">Top payer</span><strong>{analytics.payers[0]?.[0] || '—'}</strong><small>{analytics.payers.length ? money(analytics.payers[0][1], current?.currency || 'INR') : 'No payments yet'}</small></div>
              </div>
              <div className="insights-grid">
                <div><h3>Last 6 months</h3>{analytics.months.map(month => <div className="insight-bar-row" key={month.key}><span>{month.label}</span><div className="insight-bar-track"><div className="insight-bar-fill" style={{ width: `${month.amount / analytics.maxMonth * 100}%` }} /></div><strong>{money(month.amount, current?.currency || 'INR')}</strong></div>)}</div>
                <div><h3>By category</h3>{analytics.categories.length ? analytics.categories.map(([category, value]) => <div className="insight-bar-row" key={category}><span>{category.replaceAll('_', ' ')}</span><div className="insight-bar-track"><div className="insight-bar-fill" style={{ width: `${value / Math.max(1, analytics.categories[0][1]) * 100}%` }} /></div><strong>{money(value, current?.currency || 'INR')}</strong></div>) : <p className="muted">Add expenses to see category insights.</p>}</div>
              </div>
            </section>

            <div className="detail-columns">
              <div className="detail-primary-column">
                <section className="panel detail-panel" id="add-expense">
                  <div className="panel-heading"><div><h2>{editingExpenseId ? 'Edit expense' : 'Add an expense'}</h2><p className="muted">Paid by you and split equally among selected group members.</p></div><span className="add-expense-symbol">＋</span></div>
                  <form className="expense-form" onSubmit={addExpense}>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for? e.g. Groceries" required />
                    <div className="amount-input"><span>{expenseCurrency}</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></div>
                    <label>Expense currency<select value={expenseCurrency} onChange={e => setExpenseCurrency(e.target.value)}><option value={current?.currency || 'INR'}>{current?.currency || 'INR'} — group base</option>{['INR','USD','EUR','GBP','AED','SGD','CAD','AUD','JPY'].filter(code => code !== current?.currency).map(code => <option key={code} value={code}>{code}</option>)}</select></label>
                    {expenseCurrency !== current?.currency && <label>Exchange rate (1 {expenseCurrency} = ? {current?.currency})<input type="number" min="0.000001" step="0.000001" value={expenseExchangeRate} onChange={e => setExpenseExchangeRate(e.target.value)} required /></label>}
                    <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} aria-label="Expense category">
                      {['FOOD','GROCERIES','TRANSPORT','TRAVEL','RENT','UTILITIES','SHOPPING','ENTERTAINMENT','HEALTH','OTHER'].map((category) => <option key={category} value={category}>{category.replaceAll('_',' ')}</option>)}
                    </select>
                    <button className="primary" disabled={!current}>{editingExpenseId ? 'Save changes' : 'Save expense'}</button>
                    {editingExpenseId && <button className="secondary" type="button" onClick={() => { setEditingExpenseId(''); setDescription(''); setAmount(''); setExpenseCategory('OTHER'); }}>Cancel edit</button>}
                  </form>
                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Expenses</h2><p className="muted">Search, filter, edit or remove group expenses.</p></div><span className="count-pill">{visibleExpenses.length} / {expenses.length}</span></div>
                  <div className="expense-filters">
                    <input value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} placeholder="Search description or payer…" aria-label="Search expenses" />
                    <select value={expenseCategoryFilter} onChange={(e) => setExpenseCategoryFilter(e.target.value)} aria-label="Filter by category">
                      <option value="ALL">All categories</option>
                      {['FOOD','GROCERIES','TRANSPORT','TRAVEL','RENT','UTILITIES','SHOPPING','ENTERTAINMENT','HEALTH','OTHER'].map((category) => <option key={category} value={category}>{category.replaceAll('_',' ')}</option>)}
                    </select>
                    <input type="date" aria-label="From date" value={expenseFromDate} onChange={(e) => setExpenseFromDate(e.target.value)} />
                    <input type="date" aria-label="To date" value={expenseToDate} onChange={(e) => setExpenseToDate(e.target.value)} />
                  </div>
                  {visibleExpenses.length ? visibleExpenses.slice(0, showAllExpenses ? visibleExpenses.length : 5).map((expense) => (
                    <div className="detail-expense-row" key={expense.id}>
                      <div className="expense-symbol">{expense.currency}</div>
                      <div className="detail-expense-copy"><strong>{expense.description}</strong><small>{expense.category.replaceAll('_',' ')} · Paid by {expense.payers.map((payer) => payer.user.displayName).join(', ')}</small><small className="expense-date">{dateTime(expense.occurredAt)}</small>{expense.currency !== current?.currency && <small>≈ {money(expense.amountBaseMinor, current?.currency || 'INR')} in group currency</small>}</div>
                      <strong className="detail-expense-amount">{money(expense.amountMinor, expense.currency)}</strong>
                      <div className="expense-actions"><button type="button" onClick={() => editExpense(expense)}>Edit</button><button type="button" onClick={() => deleteExpense(expense)}>Delete</button></div>
                    </div>
                  )) : <div className="empty-state"><strong>{expenses.length ? 'No matching expenses' : 'No expenses yet'}</strong><p>{expenses.length ? 'Try another search or category.' : 'Add the first expense for this group below.'}</p></div>}
                  {visibleExpenses.length > 5 && <button className="secondary show-more-activity" type="button" onClick={() => setShowAllExpenses(value => !value)}>{showAllExpenses ? 'Show less' : `Show more (${visibleExpenses.length - 5})`}</button>}
                </section>


                <section className="panel detail-panel recently-deleted-panel">
                  <div className="panel-heading"><div><h2>Recently deleted</h2><p className="muted">Restore an expense to include it in group balances again.</p></div><span className="count-pill">{deletedExpenses.length}</span></div>
                  {deletedExpenses.length ? deletedExpenses.slice(0, showAllDeletedExpenses ? deletedExpenses.length : 5).map((expense) => (
                    <div className="detail-expense-row" key={expense.id}>
                      <div className="expense-symbol deleted-symbol">↶</div>
                      <div className="detail-expense-copy"><strong>{expense.description}</strong><small>{expense.category.replaceAll('_',' ')} · {dateTime(expense.occurredAt)}</small></div>
                      <strong className="detail-expense-amount">{money(expense.amountMinor, expense.currency)}</strong>
                      <div className="expense-actions"><button type="button" onClick={() => restoreExpense(expense)}>Restore</button></div>
                    </div>
                  )) : <div className="empty-state"><strong>Nothing deleted</strong><p>Deleted expenses will appear here so you can restore them.</p></div>}
                  {deletedExpenses.length > 5 && <button className="secondary show-more-activity" type="button" onClick={() => setShowAllDeletedExpenses(value => !value)}>{showAllDeletedExpenses ? 'Show less' : `Show more (${deletedExpenses.length - 5})`}</button>}
                </section>

                <section className="panel detail-panel activity-panel">
                  <div className="panel-heading"><div><h2>Group activity</h2><p className="muted">Recent changes in this group.</p></div><span className="count-pill">{activity.length}</span></div>
                  {activity.length ? (
                    <div className="activity-list">
                      {activity.slice(0, showAllActivity ? activity.length : 5).map((event) => (
                        <div className="activity-row" key={event.id}>
                          <span className="activity-dot" />
                          <div className="activity-copy">
                            <strong>{event.actor.displayName}</strong> {activityDescription(event)}
                            <small>{dateTime(event.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                      {activity.length > 5 && <button className="secondary show-more-activity" type="button" onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? 'Show less' : `Show more (${activity.length - 5})`}</button>}
                    </div>
                  ) : <div className="empty-state"><strong>No activity yet</strong><p>Group changes will appear here.</p></div>}
                </section>


                {duplicateCandidates.length > 0 && (
                  <section className="panel duplicate-warning">
                    <h3>Possible duplicate expense</h3>
                    <p className="muted">A similar expense already exists on this date. You can still add it if this is intentional.</p>
                    {duplicateCandidates.map(item => <div className="duplicate-row" key={item.id}><strong>{item.description}</strong><span>{money(item.amountMinor, item.currency)} · {dateTime(item.occurredAt)}</span></div>)}
                    <div className="duplicate-actions">
                      <button className="secondary" type="button" onClick={() => { setDuplicateCandidates([]); setPendingExpensePayload(null); }}>Cancel</button>
                      <button className="primary" type="button" onClick={async () => { try { await submitExpensePayload(pendingExpensePayload); } catch (e) { setError((e as Error).message); } }}>Add anyway</button>
                    </div>
                  </section>
                )}

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
                        {balance.netAmountMinor === 0 ? 'Settled' : balance.netAmountMinor > 0 ? `Owed ${money(balance.netAmountMinor, current?.currency || 'INR')}` : `Owes ${money(-balance.netAmountMinor, current?.currency || 'INR')}`}
                      </strong>
                      {myNet > 0 && balance.user.id !== me.id && balance.netAmountMinor < 0 && <button className="link-button reminder-button" type="button" onClick={() => sendSettlementReminder(balance.user.id)}>Remind</button>}
                    </div>
                  )) : <p className="muted balance-empty">No balances to show yet.</p>}

                </section>

                <section className="panel detail-panel">
                  <div className="panel-heading"><div><h2>Simplify debts</h2><p className="muted">Suggested payments to settle the group.</p></div><span className="count-pill">{suggestions.length}</span></div>
                  {suggestions.length ? suggestions.map((suggestion, index) => (
                    <div className="settlement-suggestion" key={suggestion.payer.id + '-' + suggestion.payee.id + '-' + index}>
                      <div><strong>{suggestion.payer.displayName}</strong><small> pays </small><strong>{suggestion.payee.displayName}</strong><small className="suggestion-amount">{money(suggestion.amountMinor, current?.currency || 'INR')}</small></div>
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
                    <label>Amount ({current?.currency || 'INR'})<input type="number" min="0.01" step="0.01" value={settlementAmount} onChange={e => setSettlementAmount(e.target.value)} placeholder="0.00" required /></label>
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
                      <strong>{money(settlement.amountMinor, current?.currency || 'INR')}</strong>
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
