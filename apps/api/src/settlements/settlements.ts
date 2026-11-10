import { Body, Controller, Get, Injectable, Param, Post, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { buildNetBalances, simplifyNetBalances } from './ledger';

const methods = ['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;

@Injectable()
class SettlementsService {
  constructor(private db: PrismaService) {}

  private async requireMember(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException('You must be a group member to view or record settlements.');
  }

  async list(userId: string, groupId: string) {
    await this.requireMember(userId, groupId);
    const rows = await this.db.settlement.findMany({
      where: { groupId },
      include: {
        payer: { select: { id: true, displayName: true } },
        payee: { select: { id: true, displayName: true } },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor) }));
  }

  async suggestions(userId: string, groupId: string) {
    await this.requireMember(userId, groupId);
    const [expenses, settlements, members] = await Promise.all([
      this.db.expense.findMany({ where: { groupId, status: 'ACTIVE' }, include: { payers: true, splits: true } }),
      this.db.settlement.findMany({ where: { groupId, status: 'CONFIRMED' }, select: { payerId: true, payeeId: true, amountMinor: true } }),
      this.db.groupMember.findMany({ where: { groupId }, include: { user: { select: { id: true, displayName: true } } } }),
    ]);
    const net = buildNetBalances(expenses, settlements);
    const balances = members.map(m => ({ user: m.user, netAmountMinor: net.get(m.userId) || 0 }));
    return simplifyNetBalances(balances);
  }

  async create(userId: string, groupId: string, body: any) {
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    if (!group) throw new NotFoundException('Group not found.');
    if (!group.members.some(m => m.userId === userId)) throw new ForbiddenException();
    const payerId = String(body.payerId || userId);
    const payeeId = String(body.payeeId || '');
    const amountMinor = Number(body.amountMinor);
    const method = String(body.method || 'CASH');
    if (!group.members.some(m => m.userId === payerId) || !group.members.some(m => m.userId === payeeId)) {
      throw new BadRequestException('Both people must be members of this group.');
    }
    if (payerId === payeeId) throw new BadRequestException('Payer and recipient must be different people.');
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Enter a valid positive payment amount.');
    if (!methods.includes(method as any)) throw new BadRequestException('Choose a valid payment method.');
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('Enter a valid payment date.');

    const settlement = await this.db.$transaction(async (tx: any) => {
      // Re-read the ledger inside a serializable transaction so concurrent
      // payment submissions cannot both spend the same outstanding balance.
      const [expenses, confirmed] = await Promise.all([
        tx.expense.findMany({ where: { groupId, status: 'ACTIVE' }, include: { payers: true, splits: true } }),
        tx.settlement.findMany({ where: { groupId, status: 'CONFIRMED' }, select: { payerId: true, payeeId: true, amountMinor: true } }),
      ]);
      const net = buildNetBalances(expenses, confirmed);
      const debtOwedByPayer = Math.max(0, -(net.get(payerId) || 0));
      const creditOwedToPayee = Math.max(0, net.get(payeeId) || 0);
      if (debtOwedByPayer <= 0 || creditOwedToPayee <= 0) {
        throw new BadRequestException('There is no outstanding balance from this payer to this recipient.');
      }
      const created = await tx.settlement.create({
        data: {
          groupId, payerId, payeeId, amountMinor: BigInt(amountMinor), currency: group.currency,
          method, status: 'CONFIRMED', note: note || null, paidAt,
        },
        include: {
          payer: { select: { id: true, displayName: true } },
          payee: { select: { id: true, displayName: true } },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'SETTLEMENT_RECORDED',
          afterData: { settlementId: created.id, payerId, payerName: created.payer.displayName, payeeId, payeeName: created.payee.displayName, amountMinor, method },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable' });
    return { ...settlement, amountMinor: Number(settlement.amountMinor) };
  }
}

@Controller('groups/:groupId/settlements')
@UseGuards(AuthGuard)
export class SettlementsController {
  constructor(private settlements: SettlementsService) {}
  @Get() list(@Req() req: any, @Param('groupId') id: string) { return this.settlements.list(req.user.id, id); }
  @Get('suggestions') suggestions(@Req() req: any, @Param('groupId') id: string) { return this.settlements.suggestions(req.user.id, id); }
  @Post() create(@Req() req: any, @Param('groupId') id: string, @Body() body: any) { return this.settlements.create(req.user.id, id, body); }
}
export const settlementsProviders = [SettlementsService];
