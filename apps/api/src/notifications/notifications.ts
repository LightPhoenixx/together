import { Body, Controller, Get, Injectable, Param, Post, Query, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { buildNetBalances } from '../settlements/ledger';

@Injectable()
class NotificationsService {
  constructor(private db: PrismaService) {}

  async list(userId: string, query: any) {
    const take = Math.min(50, Math.max(1, Number(query.limit) || 30));
    const [items, unreadCount] = await Promise.all([
      this.db.notification.findMany({ where: { userId }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'desc' }, take }),
      this.db.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const row = await this.db.notification.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Notification not found.');
    if (!row.readAt) await this.db.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { read: true };
  }

  async markAllRead(userId: string) {
    const result = await this.db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  async remind(userId: string, body: any) {
    const groupId = String(body.groupId || '');
    const recipientId = String(body.recipientId || '');
    if (!groupId || !recipientId || recipientId === userId) throw new BadRequestException('Choose another group member to remind.');
    const [group, members, expenses, settlements] = await Promise.all([
      this.db.group.findUnique({ where: { id: groupId }, select: { currency: true } }),
      this.db.groupMember.findMany({ where: { groupId }, include: { user: { select: { displayName: true } } } }),
      this.db.expense.findMany({ where: { groupId, status: 'ACTIVE' }, include: { payers: true, splits: true } }),
      this.db.settlement.findMany({ where: { groupId, status: 'CONFIRMED' }, select: { payerId: true, payeeId: true, amountMinor: true } }),
    ]);
    if (!group) throw new NotFoundException('Group not found.');
    const memberIds = members.map(m => m.userId);
    if (!memberIds.includes(userId) || !memberIds.includes(recipientId)) throw new ForbiddenException('Both people must belong to this group.');
    const net = buildNetBalances(expenses, settlements);
    const owedByRecipient = Math.max(0, -(net.get(recipientId) || 0));
    const owedToSender = Math.max(0, net.get(userId) || 0);
    const amount = Math.min(owedByRecipient, owedToSender);
    if (amount <= 0) throw new BadRequestException('There is no outstanding balance from this person to you.');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.db.notification.findFirst({ where: { userId: recipientId, actorId: userId, groupId, type: 'SETTLEMENT_REMINDER', createdAt: { gte: since } } });
    if (recent) throw new BadRequestException('You already sent this person a reminder in the last 24 hours.');
    await this.db.notification.create({ data: {
      userId: recipientId, actorId: userId, groupId, type: 'SETTLEMENT_REMINDER',
      title: 'Settlement reminder',
      message: `You have an outstanding balance of ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: group.currency }).format(amount / 100)} to settle in this group.`,
      entityType: 'GROUP', entityId: groupId,
    } });
    return { sent: true };
  }
}

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}
  @Get() list(@Req() req: any, @Query() query: any) { return this.notifications.list(req.user.id, query); }
  @Post('read-all') markAllRead(@Req() req: any) { return this.notifications.markAllRead(req.user.id); }
  @Post(':id/read') markRead(@Req() req: any, @Param('id') id: string) { return this.notifications.markRead(req.user.id, id); }
  @Post('remind') remind(@Req() req: any, @Body() body: any) { return this.notifications.remind(req.user.id, body); }
}
export const notificationsProviders = [NotificationsService];
