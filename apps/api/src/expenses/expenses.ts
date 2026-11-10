import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, Query, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { notifyUsers } from '../common/notifications';
import { splitEqually, assertSplitTotal } from '@expense/shared';
import { buildNetBalances } from '../settlements/ledger';

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
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Amount must be a positive number of paise.');
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
    const splits = Array.isArray(body.splits) && body.splits.length
      ? body.splits.map((s: any) => ({ userId: String(s.userId), amountMinor: Number(s.amountMinor) }))
      : splitEqually(amountMinor, splitIds);
    try { assertSplitTotal(amountMinor, splits); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (splits.some((s: any) => !splitIds.includes(s.userId) || !Number.isSafeInteger(s.amountMinor) || s.amountMinor < 0)) {
      throw new BadRequestException('Invalid split values.');
    }
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Enter a valid expense date.');
    return {
      amountMinor, description, category, occurredAt,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) || null : null,
      payerAmounts: splitEqually(amountMinor, payerIds),
      splits,
    };
  }

  private serialize(expense: any) {
    return {
      ...expense,
      amountMinor: Number(expense.amountMinor),
      payers: expense.payers.map((p: any) => ({ ...p, amountMinor: Number(p.amountMinor) })),
      splits: expense.splits.map((s: any) => ({ ...s, amountMinor: Number(s.amountMinor) })),
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
        amountMinor: BigInt(input.amountMinor), currency: group.currency, category: input.category,
        splitMethod: body.splitMethod === 'EXACT' ? 'EXACT' : 'EQUAL', occurredAt: input.occurredAt,
        payers: { create: input.payerAmounts.map(p => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor) })) },
        splits: { create: input.splits.map((s: any) => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor) })) },
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
    const rows = await this.db.expense.findMany({
      where: { groupId, status: 'ACTIVE', amountMinor: BigInt(amountMinor), occurredAt: { gte: start, lte: end }, description: { equals: description, mode: 'insensitive' } },
      select: { id: true, description: true, amountMinor: true, occurredAt: true, category: true },
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
          category: input.category, occurredAt: input.occurredAt,
          splitMethod: body.splitMethod === 'EXACT' ? 'EXACT' : 'EQUAL',
          payers: { create: input.payerAmounts.map((p: any) => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor) })) },
          splits: { create: input.splits.map((s: any) => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor) })) },
        },
        include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } },
      });
      await tx.auditEvent.create({ data: {
        actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'EXPENSE_UPDATED',
        beforeData: before, afterData: { expenseId, description: row.description, amountMinor: input.amountMinor, category: input.category },
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
