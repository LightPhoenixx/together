import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { splitEqually } from '@expense/shared';

function nextOccurrence(date: Date, frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY', interval: number) {
  const next = new Date(date);
  if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7 * interval);
  if (frequency === 'MONTHLY') {
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + interval);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
  }
  if (frequency === 'YEARLY') {
    const month = next.getMonth(), day = next.getDate();
    next.setDate(1); next.setFullYear(next.getFullYear() + interval);
    const lastDay = new Date(next.getFullYear(), month + 1, 0).getDate();
    next.setMonth(month); next.setDate(Math.min(day, lastDay));
  }
  return next;
}

@Injectable()
class RecurringExpensesService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private db: PrismaService) {}
  onModuleInit() {
    void this.processDue();
    this.timer = setInterval(() => void this.processDue(), 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async create(userId: string, groupId: string, body: any) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('You must be a group member.');
    const description = String(body.description ?? '').trim();
    const amountMinor = Number(body.amountMinor);
    const frequency = body.frequency;
    const interval = Number(body.interval ?? 1);
    const nextRunAt = body.nextRunAt ? new Date(body.nextRunAt) : new Date();
    if (!description || description.length > 120 || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Enter a valid description and amount.');
    if (!['WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) throw new BadRequestException('Choose weekly, monthly or yearly frequency.');
    if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw new BadRequestException('Interval must be between 1 and 12.');
    if (Number.isNaN(nextRunAt.getTime())) throw new BadRequestException('Enter a valid first due date.');
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) throw new BadRequestException('Group not found.');
    const payerIds = Array.isArray(body.payerIds) ? [...new Set(body.payerIds.filter((x: unknown): x is string => typeof x === 'string'))] : [userId];
    const splitUserIds = Array.isArray(body.splitUserIds) ? [...new Set(body.splitUserIds.filter((x: unknown): x is string => typeof x === 'string'))] : group.members.map(m => m.userId);
    const memberIds = group.members.map(m => m.userId);
    if (!payerIds.length || !splitUserIds.length || [...payerIds, ...splitUserIds].some(id => !memberIds.includes(id))) throw new BadRequestException('Payers and participants must be group members.');
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt < nextRunAt)) throw new BadRequestException('End date must be on or after the first due date.');
    return this.db.recurringExpense.create({ data: {
      groupId, createdById: userId, description, amountMinor: BigInt(amountMinor), currency: group.currency,
      category: String(body.category || 'OTHER'), notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null,
      frequency, interval, payerIds, splitUserIds, nextRunAt, endsAt,
    } });
  }

  async list(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('You must be a group member.');
    const rows = await this.db.recurringExpense.findMany({ where: { groupId }, orderBy: { nextRunAt: 'asc' } });
    return rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor) }));
  }

  async processDue() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.db.recurringExpense.findMany({ where: { isActive: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 100 });
      for (const rule of due) {
        let occurrence = new Date(rule.nextRunAt);
        while (occurrence <= now && (!rule.endsAt || occurrence <= rule.endsAt)) {
          const payerIds = rule.payerIds as string[];
          const splitIds = rule.splitUserIds as string[];
          const payers = splitEqually(Number(rule.amountMinor), payerIds);
          const splits = splitEqually(Number(rule.amountMinor), splitIds);
          try {
            await this.db.$transaction(async tx => {
              await tx.expense.create({ data: {
                groupId: rule.groupId, createdById: rule.createdById, description: rule.description, notes: rule.notes,
                category: rule.category, amountMinor: rule.amountMinor, currency: rule.currency, splitMethod: 'EQUAL',
                occurredAt: occurrence, recurringExpenseId: rule.id, recurrenceDate: occurrence,
                payers: { create: payers.map(p => ({ userId: p.userId, amountMinor: BigInt(p.amountMinor) })) },
                splits: { create: splits.map(s => ({ userId: s.userId, amountMinor: BigInt(s.amountMinor) })) },
              } });
              await tx.auditEvent.create({ data: { actorId: rule.createdById, entityType: 'GROUP', entityId: rule.groupId, action: 'RECURRING_EXPENSE_GENERATED', afterData: { recurringExpenseId: rule.id, description: rule.description, amountMinor: Number(rule.amountMinor), occurrence: occurrence.toISOString() } } });
            });
          } catch (error: any) {
            if (error?.code !== 'P2002') throw error;
          }
          occurrence = nextOccurrence(occurrence, rule.frequency, rule.interval);
        }
        await this.db.recurringExpense.update({ where: { id: rule.id }, data: { nextRunAt: occurrence, ...(rule.endsAt && occurrence > rule.endsAt ? { isActive: false } : {}) } });
      }
    } catch (error) {
      // A later scheduler tick retries the due occurrence; its unique key prevents duplicates.
    } finally { this.running = false; }
  }
}

@Controller('groups/:groupId/recurring-expenses')
@UseGuards(AuthGuard)
export class RecurringExpensesController {
  constructor(private service: RecurringExpensesService) {}
  @Get() list(@Req() req: any, @Param('groupId') id: string) { return this.service.list(req.user.id, id); }
  @Post() create(@Req() req: any, @Param('groupId') id: string, @Body() body: any) { return this.service.create(req.user.id, id, body); }
}
export const recurringExpensesProviders = [RecurringExpensesService];
