import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, Query, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { notifyUsers } from '../common/notifications';
import { splitEqually, assertSplitTotal } from '@expense/shared';
import { buildNetBalances } from '../settlements/ledger';
import { SplitMethod as PrismaSplitMethod } from '@prisma/client';

const categories = ['FOOD', 'GROCERIES', 'TRANSPORT', 'TRAVEL', 'RENT', 'UTILITIES', 'SHOPPING', 'ENTERTAINMENT', 'HEALTH', 'OTHER'] as const;

@Injectable()
class ExpensesService {
  constructor(private db: PrismaService) {}

  private async getGroupMember(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('You must be a group member to access these expenses.');
    return member;
  }

  private validateExpense(group: any, body: any, fallbackPayerIds: string[]) {
    const memberIds: string[] = group.members.map((m: any) => m.userId);
    const amountMinor = Number(body.amountMinor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Amount must be a positive number of minor currency units.');
    const currency = String(body.currency || group.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Currency must be a 3-letter ISO code.');
    const rawRate = currency === group.currency ? 1 : Number(body.exchangeRate);
    if (!Number.isFinite(rawRate) || rawRate <= 0 || rawRate > 1000000) throw new BadRequestException(`Enter a valid ${group.currency} per 1 ${currency} exchange rate.`);
    const exchangeRateMicros = Math.round(rawRate * 1000000);
    if (!Number.isSafeInteger(exchangeRateMicros) || exchangeRateMicros <= 0) throw new BadRequestException('Exchange rate has too many decimal places.');
    const amountBaseMinor = Math.round(amountMinor * exchangeRateMicros / 1000000);
    if (!Number.isSafeInteger(amountBaseMinor) || amountBaseMinor <= 0) throw new BadRequestException('Converted amount is outside the supported range.');
    const description = String(body.description ?? '').trim();
    if (!description || description.length > 120) throw new BadRequestException('Description is required and must be at most 120 characters.');
    const category = String(body.category || 'OTHER').toUpperCase();
    if (!categories.includes(category as any)) throw new BadRequestException('Choose a valid expense category.');
    const rawPayerIds: unknown = body.payerIds;
    const rawSplitIds: unknown = body.splitUserIds;
    const payerIds: string[] = Array.isArray(rawPayerIds)
      ? [...new Set((rawPayerIds as unknown[]).filter((id): id is string => typeof id === 'string'))]
      : fallbackPayerIds;
    const splitIds: string[] = Array.isArray(rawSplitIds)
      ? [...new Set((rawSplitIds as unknown[]).filter((id): id is string => typeof id === 'string'))]
      : memberIds;
    if (!payerIds.length || !splitIds.length || [...payerIds, ...splitIds].some(id => !memberIds.includes(id))) {
      throw new BadRequestException('Payers and participants must be group members.');
    }
    const rawSplitMethod = String(body.splitMethod || 'EQUAL').toUpperCase();
    if (!['EQUAL', 'EXACT', 'PERCENTAGE', 'SHARES'].includes(rawSplitMethod)) throw new BadRequestException('Choose a valid split method.');
    const splitMethod = rawSplitMethod as PrismaSplitMethod;
    let splits: { userId: string; amountMinor: number; percentageBps?: number | null; shareUnits?: number | null }[];
    if (splitMethod === 'EQUAL') {
      splits = splitEqually(amountMinor, splitIds);
    } else if (splitMethod === 'EXACT') {
      if (!Array.isArray(body.splits)) throw new BadRequestException('Enter an exact amount for each participant.');
      splits = body.splits.map((s: any) => ({ userId: String(s.userId), amountMinor: Number(s.amountMinor) }));
    } else if (splitMethod === 'PERCENTAGE') {
      if (!Array.isArray(body.splits)) throw new BadRequestException('Enter a percentage for each participant.');
      const rows: { userId: string; value: number }[] = body.splits.map((s: any) => ({ userId: String(s.userId), value: Number(s.percentage) }));
      if (rows.some(row => !Number.isFinite(row.value) || row.value < 0 || row.value > 100) || Math.round(rows.reduce((sum, row) => sum + row.value, 0) * 100) !== 10000) {
        throw new BadRequestException('Participant percentages must add up to exactly 100%.');
      }
      const raw = rows.map((row, index) => ({ ...row, index, exact: amountMinor * row.value / 100, amountMinor: Math.floor(amountMinor * row.value / 100) }));
      let remainder = amountMinor - raw.reduce((sum, row) => sum + row.amountMinor, 0);
      [...raw].sort((x, y) => (y.exact - y.amountMinor) - (x.exact - x.amountMinor) || x.index - y.index).slice(0, remainder).forEach(row => { raw[row.index].amountMinor += 1; });
      splits = raw.map(row => ({ userId: row.userId, amountMinor: row.amountMinor, percentageBps: Math.round(row.value * 100) }));
    } else {
      if (!Array.isArray(body.splits)) throw new BadRequestException('Enter share units for each participant.');
      const rows: { userId: string; units: number }[] = body.splits.map((s: any) => ({ userId: String(s.userId), units: Number(s.shareUnits) }));
      if (rows.some(row => !Number.isSafeInteger(row.units) || row.units < 0) || rows.reduce((sum, row) => sum + row.units, 0) <= 0) throw new BadRequestException('Share units must be non-negative integers and at least one share is required.');
      const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
      const raw = rows.map((row, index) => ({ ...row, index, exact: amountMinor * row.units / totalUnits, amountMinor: Math.floor(amountMinor * row.units / totalUnits) }));
      const remainder = amountMinor - raw.reduce((sum, row) => sum + row.amountMinor, 0);
      [...raw].sort((x, y) => (y.exact - y.amountMinor) - (x.exact - x.amountMinor) || x.index - y.index).slice(0, remainder).forEach(row => { raw[row.index].amountMinor += 1; });
      splits = raw.map(row => ({ userId: row.userId, amountMinor: row.amountMinor, shareUnits: row.units }));
    }
    try { assertSplitTotal(amountMinor, splits); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (splits.length !== splitIds.length || new Set(splits.map(s => s.userId)).size !== splitIds.length || splits.some((s: any) => !splitIds.includes(s.userId) || !Number.isSafeInteger(s.amountMinor) || s.amountMinor < 0)) {
      throw new BadRequestException('Provide exactly one valid split for each selected participant.');
    }
    const rawPayers = Array.isArray(body.payers) ? body.payers : null;
    const payerAmounts: { userId: string; amountMinor: number }[] = rawPayers
      ? rawPayers.map((p: any) => ({ userId: String(p.userId), amountMinor: Number(p.amountMinor) }))
      : splitEqually(amountMinor, payerIds);
    if (payerAmounts.length !== payerIds.length || new Set(payerAmounts.map((p: any) => p.userId)).size !== payerIds.length || payerAmounts.some((p: any) => !payerIds.includes(p.userId) || !Number.isSafeInteger(p.amountMinor) || p.amountMinor < 0) || payerAmounts.reduce((sum: number, p: any) => sum + p.amountMinor, 0) !== amountMinor) {
      throw new BadRequestException('Payer contributions must be valid and add up to the expense total.');
    }
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Enter a valid expense date.');
    const toBaseRows = (rows: { userId: string; amountMinor: number }[]) => {
      const exact = rows.map((row, index) => {
        const raw = row.amountMinor * exchangeRateMicros / 1000000;
        const floor = Math.floor(raw);
        return { userId: row.userId, amountMinor: floor, remainder: raw - floor, index };
      });
      const remaining = amountBaseMinor - exact.reduce((sum, row) => sum + row.amountMinor, 0);
      const priority = [...exact].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
      for (let i = 0; i < remaining; i++) { const row = priority[i]; if (row) row.amountMinor += 1; }
      return exact.map(({ userId, amountMinor }) => ({ userId, amountMinor }));
    };
    return {
      amountMinor, amountBaseMinor, exchangeRateMicros, currency, description, category, occurredAt, splitMethod,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null,
      payerAmounts: payerAmounts,
      payerBaseAmounts: toBaseRows(payerAmounts),
      splits,
      baseSplits: toBaseRows(splits),
    };
  }

  private serialize(expense: any) {
    return {
      ...expense,
      amountMinor: Number(expense.amountMinor),
      amountBaseMinor: Number(expense.amountBaseMinor ?? expense.amountMinor),
      exchangeRate: Number(expense.exchangeRateMicros ?? BigInt(1000000)) / 1000000,
      exchangeRateMicros: Number(expense.exchangeRateMicros ?? BigInt(1000000)),
      payers: expense.payers.map((p: any) => ({ ...p, amountMinor: Number(p.amountMinor), amountBaseMinor: Number(p.amountBaseMinor ?? p.amountMinor) })),
      splits: expense.splits.map((s: any) => ({ ...s, amountMinor: Number(s.amountMinor), amountBaseMinor: Number(s.amountBaseMinor ?? s.amountMinor) })),
    };
  }

  async create(userId: string, groupId: string, body: any) {
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) throw new NotFoundException('Group not found.');
    if (!group.members.some(m => m.userId === userId)) throw new ForbiddenException();
    const input = this.validateExpense(group, body, [userId]);
    const created = await this.db.expense.create({
      data: {
        groupId, createdById: userId, description: input.description, notes: input.notes,
        amountMinor: BigInt(input.amountMinor), amountBaseMinor: BigInt(input.amountBaseMinor), exchangeRateMicros: BigInt(input.exchangeRateMicros), currency: input.currency, category: input.category,
        splitMethod: input.splitMethod, occurredAt: input.occurredAt,
        payers: { create: input.payerAmounts.map((p, i) => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor), amountBaseMinor: BigInt(input.payerBaseAmounts[i].amountMinor) })) },
        splits: { create: input.splits.map((s: any, i: number) => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor), amountBaseMinor: BigInt(input.baseSplits[i].amountMinor), percentageBps: s.percentageBps ?? null, shareUnits: s.shareUnits ?? null })) },
      },
      include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } },
    });
    await this.db.auditEvent.create({ data: {
      actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'EXPENSE_CREATED',
      afterData: { expenseId: created.id, description: created.description, amountMinor: input.amountMinor, category: input.category, currency: created.currency },
    } });
    await notifyUsers(this.db, group.members.map(m => m.userId), userId, { type: 'GROUP_EXPENSE_CREATED', title: 'New group expense', message: `${input.description} was added to ${group.name}.`, groupId, entityType: 'EXPENSE', entityId: created.id });
    return this.serialize(created);
  }


  async findPossibleDuplicates(userId: string, groupId: string, body: any) {
    await this.getGroupMember(userId, groupId);
    const amountMinor = Number(body.amountMinor);
    const description = String(body.description ?? '').trim();
    const date = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !description || Number.isNaN(date.getTime())) {
      throw new BadRequestException('Enter a valid description, amount and date.');
    }
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    const group = await this.db.group.findUnique({ where: { id: groupId }, select: { currency: true } });
    const currency = String(body.currency || group?.currency || 'INR').toUpperCase();
    const rows = await this.db.expense.findMany({
      where: { groupId, status: 'ACTIVE', amountMinor: BigInt(amountMinor), currency, occurredAt: { gte: start, lte: end }, description: { equals: description, mode: 'insensitive' } },
      select: { id: true, description: true, amountMinor: true, currency: true, occurredAt: true, category: true },
      take: 5,
    });
    return rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor) }));
  }

  async list(userId: string, groupId: string, query: any) {
    await this.getGroupMember(userId, groupId);
    const where: any = { groupId, status: 'ACTIVE' };
    if (typeof query.search === 'string' && query.search.trim()) where.description = { contains: query.search.trim().slice(0, 100), mode: 'insensitive' };
    if (typeof query.category === 'string' && query.category !== 'ALL') {
      const category = query.category.toUpperCase();
      if (!categories.includes(category as any)) throw new BadRequestException('Choose a valid expense category.');
      where.category = category;
    }
    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) { const from = new Date(query.from); if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid start date.'); where.occurredAt.gte = from; }
      if (query.to) { const to = new Date(query.to); if (Number.isNaN(to.getTime())) throw new BadRequestException('Invalid end date.'); to.setHours(23, 59, 59, 999); where.occurredAt.lte = to; }
    }
    const rows = await this.db.expense.findMany({
      where,
      include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map(e => this.serialize(e));
  }

  async listDeleted(userId: string, groupId: string) {
    await this.getGroupMember(userId, groupId);
    const rows = await this.db.expense.findMany({
      where: { groupId, status: 'DELETED' },
      include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } },
      orderBy: { deletedAt: 'desc' },
    });
    return rows.map(e => this.serialize(e));
  }

  private async assertCanManage(userId: string, groupId: string, expenseId: string) {
    const expense = await this.db.expense.findFirst({ where: { id: expenseId, groupId, status: 'ACTIVE' }, include: { payers: true, splits: true } });
    if (!expense) throw new NotFoundException('Expense not found.');
    const member = await this.getGroupMember(userId, groupId);
    if (expense.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the person who added this expense or a group admin can change it.');
    }
    return expense;
  }

  async update(userId: string, groupId: string, expenseId: string, body: any) {
    const existing = await this.assertCanManage(userId, groupId, expenseId);
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) throw new NotFoundException('Group not found.');
    const input = this.validateExpense(group, body, existing.payers.map((p: any) => p.userId));
    const before = { description: existing.description, amountMinor: Number(existing.amountMinor), category: existing.category, occurredAt: existing.occurredAt.toISOString() };
    const updated = await this.db.$transaction(async (tx: any) => {
      await tx.expensePayer.deleteMany({ where: { expenseId } });
      await tx.expenseSplit.deleteMany({ where: { expenseId } });
      const row = await tx.expense.update({
        where: { id: expenseId },
        data: {
          description: input.description, notes: input.notes, amountMinor: BigInt(input.amountMinor),
          amountBaseMinor: BigInt(input.amountBaseMinor), exchangeRateMicros: BigInt(input.exchangeRateMicros), currency: input.currency,
          category: input.category, occurredAt: input.occurredAt,
          splitMethod: input.splitMethod,
          payers: { create: input.payerAmounts.map((p: any, i: number) => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor), amountBaseMinor: BigInt(input.payerBaseAmounts[i].amountMinor) })) },
          splits: { create: input.splits.map((s: any, i: number) => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor), amountBaseMinor: BigInt(input.baseSplits[i].amountMinor) })) },
        },
        include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } },
      });
      await tx.auditEvent.create({ data: {
        actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'EXPENSE_UPDATED',
        beforeData: before, afterData: { expenseId, description: row.description, amountMinor: input.amountMinor, amountBaseMinor: input.amountBaseMinor, currency: input.currency, category: input.category },
      } });
      return row;
    });
    await notifyUsers(this.db, group.members.map(m => m.userId), userId, { type: 'GROUP_EXPENSE_UPDATED', title: 'Group expense updated', message: `${input.description} was updated in ${group.name}.`, groupId, entityType: 'EXPENSE', entityId: expenseId });
    return this.serialize(updated);
  }

  async remove(userId: string, groupId: string, expenseId: string) {
    const existing = await this.assertCanManage(userId, groupId, expenseId);
    await this.db.$transaction(async (tx: any) => {
      await tx.expense.update({ where: { id: expenseId }, data: { status: 'DELETED', deletedAt: new Date() } });
      await tx.auditEvent.create({ data: {
        actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'EXPENSE_DELETED',
        beforeData: { expenseId, description: existing.description, amountMinor: Number(existing.amountMinor) },
      } });
    });
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    await notifyUsers(this.db, (group?.members || []).map(m => m.userId), userId, { type: 'GROUP_EXPENSE_DELETED', title: 'Group expense deleted', message: `${existing.description} was deleted.`, groupId, entityType: 'EXPENSE', entityId: expenseId });
    return { deleted: true };
  }

  async restore(userId: string, groupId: string, expenseId: string) {
    const existing = await this.db.expense.findFirst({
      where: { id: expenseId, groupId, status: 'DELETED' },
      include: { payers: true, splits: true },
    });
    if (!existing) throw new NotFoundException('Deleted expense not found.');
    const member = await this.getGroupMember(userId, groupId);
    if (existing.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the person who added this expense or a group admin can restore it.');
    }
    await this.db.$transaction(async (tx: any) => {
      await tx.expense.update({ where: { id: expenseId }, data: { status: 'ACTIVE', deletedAt: null } });
      await tx.auditEvent.create({ data: {
        actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'EXPENSE_RESTORED',
        afterData: { expenseId, description: existing.description, amountMinor: Number(existing.amountMinor), category: existing.category },
      } });
    });
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    await notifyUsers(this.db, (group?.members || []).map(m => m.userId), userId, { type: 'GROUP_EXPENSE_RESTORED', title: 'Group expense restored', message: `${existing.description} was restored.`, groupId, entityType: 'EXPENSE', entityId: expenseId });
    return { restored: true };
  }

  async balances(userId: string, groupId: string) {
    await this.getGroupMember(userId, groupId);
    const expenses = await this.db.expense.findMany({ where: { groupId, status: 'ACTIVE' }, include: { payers: true, splits: true } });
    const settlements = await this.db.settlement.findMany({
      where: { groupId, status: 'CONFIRMED' },
      select: { payerId: true, payeeId: true, amountMinor: true },
    });
    const net = buildNetBalances(expenses, settlements);
    const users = await this.db.groupMember.findMany({ where: { groupId }, include: { user: { select: { id: true, displayName: true, email: true } } } });
    return users.map(m => ({ user: m.user, netAmountMinor: net.get(m.userId) || 0 }));
  }
}

@Controller('groups/:groupId/expenses')
@UseGuards(AuthGuard)
export class ExpensesController {
  constructor(private expenses: ExpensesService) {}
  @Post('duplicate-check') duplicateCheck(@Req() req: any, @Param('groupId') id: string, @Body() body: any) { return this.expenses.findPossibleDuplicates(req.user.id, id, body); }
  @Post() create(@Req() req: any, @Param('groupId') id: string, @Body() body: any) { return this.expenses.create(req.user.id, id, body); }
  @Get() list(@Req() req: any, @Param('groupId') id: string, @Query() query: any) { return this.expenses.list(req.user.id, id, query); }
  @Get('deleted') listDeleted(@Req() req: any, @Param('groupId') id: string) { return this.expenses.listDeleted(req.user.id, id); }
  @Post(':expenseId/restore') restore(@Req() req: any, @Param('groupId') groupId: string, @Param('expenseId') expenseId: string) { return this.expenses.restore(req.user.id, groupId, expenseId); }
  @Put(':expenseId') update(@Req() req: any, @Param('groupId') groupId: string, @Param('expenseId') expenseId: string, @Body() body: any) { return this.expenses.update(req.user.id, groupId, expenseId, body); }
  @Delete(':expenseId') remove(@Req() req: any, @Param('groupId') groupId: string, @Param('expenseId') expenseId: string) { return this.expenses.remove(req.user.id, groupId, expenseId); }
}

@Controller('groups/:groupId/balances')
@UseGuards(AuthGuard)
export class BalancesController {
  constructor(private expenses: ExpensesService) {}
  @Get() get(@Req() req: any, @Param('groupId') id: string) { return this.expenses.balances(req.user.id, id); }
}
export const expensesProviders = [ExpensesService];
