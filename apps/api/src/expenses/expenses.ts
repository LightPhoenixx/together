import { Body, Controller, Get, Injectable, Param, Post, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { splitEqually, assertSplitTotal } from '@expense/shared';
import { buildNetBalances } from '../settlements/ledger';

@Injectable()
class ExpensesService {
  constructor(private db: PrismaService) {}
  async create(userId: string, body: any) {
    const groupId = String(body.groupId ?? '');
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } }); if (!group) throw new NotFoundException('Group not found.');
    const memberIds = group.members.map(m => m.userId); if (!memberIds.includes(userId)) throw new ForbiddenException();
    const amountMinor = Number(body.amountMinor); if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Amount must be a positive number of paise.');
    const description = String(body.description ?? '').trim(); if (!description) throw new BadRequestException('Description is required.');
    const rawPayerIds: unknown = body.payerIds;
    const rawSplitIds: unknown = body.splitUserIds;

    const payerIds: string[] = Array.isArray(rawPayerIds)
      ? [...new Set((rawPayerIds as string[]).filter((id: string) => typeof id === 'string'))]
      : [userId];

    const splitIds: string[] = Array.isArray(rawSplitIds)
      ? [...new Set((rawSplitIds as string[]).filter((id: string) => typeof id === 'string'))]
      : memberIds;
    if (!payerIds.length || !splitIds.length || [...payerIds, ...splitIds].some(id => !memberIds.includes(id))) throw new BadRequestException('Payers and participants must be group members.');
    const splits = body.splits?.length ? body.splits.map((s: any) => ({ userId: String(s.userId), amountMinor: Number(s.amountMinor) })) : splitEqually(amountMinor, splitIds);
    try { assertSplitTotal(amountMinor, splits); } catch (e) { throw new BadRequestException((e as Error).message); }
    if (splits.some((s: any) => !splitIds.includes(s.userId) || !Number.isSafeInteger(s.amountMinor) || s.amountMinor < 0)) throw new BadRequestException('Invalid split values.');
    const payerAmounts = splitEqually(amountMinor, payerIds);
    const created = await this.db.expense.create({ data: { groupId, createdById: userId, description, notes: body.notes || null, amountMinor: BigInt(amountMinor), currency: group.currency, splitMethod: body.splitMethod === 'EXACT' ? 'EXACT' : 'EQUAL', occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(), payers: { create: payerAmounts.map(p => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor) })) }, splits: { create: splits.map((s: any) => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor) })) } }, include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } } });
    await this.db.auditEvent.create({
      data: {
        actorId: userId,
        entityType: 'GROUP',
        entityId: groupId,
        action: 'EXPENSE_CREATED',
        afterData: { expenseId: created.id, description: created.description, amountMinor, currency: created.currency },
      },
    });
    return { ...created, amountMinor: Number(created.amountMinor), payers: created.payers.map(p => ({ ...p, amountMinor: Number(p.amountMinor) })), splits: created.splits.map(s => ({ ...s, amountMinor: Number(s.amountMinor) })) };
  }
  async list(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }); if (!member) throw new ForbiddenException();
    const rows = await this.db.expense.findMany({ where: { groupId, status: 'ACTIVE' }, include: { payers: { include: { user: { select: { id: true, displayName: true } } } }, splits: { include: { user: { select: { id: true, displayName: true } } } } }, orderBy: { occurredAt: 'desc' } });
    return rows.map(e => ({ ...e, amountMinor: Number(e.amountMinor), payers: e.payers.map(p => ({ ...p, amountMinor: Number(p.amountMinor) })), splits: e.splits.map(s => ({ ...s, amountMinor: Number(s.amountMinor) })) }));
  }
  async balances(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }); if (!member) throw new ForbiddenException();
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
  @Post() create(@Req() req: any, @Param('groupId') id: string, @Body() body: any) { return this.expenses.create(req.user.id, { ...body, groupId: id }); }
  @Get() list(@Req() req: any, @Param('groupId') id: string) { return this.expenses.list(req.user.id, id); }
}
@Controller('groups/:groupId/balances')
@UseGuards(AuthGuard)
export class BalancesController {
  constructor(private expenses: ExpensesService) {}
  @Get() get(@Req() req: any, @Param('groupId') id: string) { return this.expenses.balances(req.user.id, id); }
}
export const expensesProviders = [ExpensesService];
