import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { notifyUsers } from '../common/notifications';

@Injectable()
class FriendsService {
  constructor(private db: PrismaService) {}
  private async acceptedFriend(userId: string, friendId: string) {
    const row = await this.db.friendship.findFirst({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId, addresseeId: friendId }, { requesterId: friendId, addresseeId: userId }] } });
    if (!row) throw new ForbiddenException('You can only share direct expenses with an accepted friend.');
  }
  private pairKey(a: string, b: string) { return [a, b].sort().join(':'); }
  private async log(actorId: string, friendId: string, action: string, afterData: Record<string, unknown>) {
    await this.db.auditEvent.create({ data: { actorId, entityType: 'DIRECT_FRIEND', entityId: this.pairKey(actorId, friendId), action, afterData: afterData as Prisma.InputJsonValue } });
  }
  async search(userId: string, q: string) {
    const term = String(q || '').trim(); if (term.length < 2) return [];
    return this.db.user.findMany({ where: { id: { not: userId }, OR: [{ email: { contains: term, mode: 'insensitive' } }, { displayName: { contains: term, mode: 'insensitive' } }] }, select: { id: true, displayName: true, email: true }, take: 10 });
  }
  async list(userId: string) {
    const rows = await this.db.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, include: { requester: { select: { id: true, displayName: true, email: true } }, addressee: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(row => ({ id: row.id, friend: row.requesterId === userId ? row.addressee : row.requester, createdAt: row.createdAt }));
  }
  async requests(userId: string) {
    const [incoming, outgoing] = await Promise.all([
      this.db.friendship.findMany({ where: { addresseeId: userId, status: 'PENDING' }, include: { requester: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'desc' } }),
      this.db.friendship.findMany({ where: { requesterId: userId, status: 'PENDING' }, include: { addressee: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { incoming: incoming.map(x => ({ id: x.id, user: x.requester, createdAt: x.createdAt })), outgoing: outgoing.map(x => ({ id: x.id, user: x.addressee, createdAt: x.createdAt })) };
  }
  async sendRequest(userId: string, email: string) {
    const normalized = String(email || '').trim().toLowerCase(); if (!normalized) throw new BadRequestException('Enter an email address.');
    const target = await this.db.user.findUnique({ where: { email: normalized } }); if (!target) throw new NotFoundException('No Together account found for that email.');
    if (target.id === userId) throw new BadRequestException('You cannot add yourself as a friend.');
    const existing = await this.db.friendship.findFirst({ where: { OR: [{ requesterId: userId, addresseeId: target.id }, { requesterId: target.id, addresseeId: userId }] } });
    if (existing?.status === 'ACCEPTED') throw new BadRequestException('You are already friends.');
    if (existing?.requesterId === target.id) throw new BadRequestException('This person has already sent you a request. Accept it from incoming requests.');
    if (existing) return { id: existing.id, status: existing.status };
    const row = await this.db.friendship.create({ data: { requesterId: userId, addresseeId: target.id } });
    await notifyUsers(this.db, [target.id], userId, { type: 'FRIEND_REQUEST', title: 'New friend request', message: 'Someone sent you a friend request.', entityType: 'FRIENDSHIP', entityId: row.id });
    return { id: row.id, status: row.status };
  }
  async accept(userId: string, id: string) {
    const row = await this.db.friendship.findFirst({ where: { id, addresseeId: userId, status: 'PENDING' } }); if (!row) throw new NotFoundException('Friend request not found.');
    const updated = await this.db.friendship.update({ where: { id }, data: { status: 'ACCEPTED' } });
    await notifyUsers(this.db, [row.requesterId], userId, { type: 'FRIEND_REQUEST_ACCEPTED', title: 'Friend request accepted', message: 'Your friend request was accepted.', entityType: 'FRIENDSHIP', entityId: id });
    return updated;
  }
  async decline(userId: string, id: string) {
    const row = await this.db.friendship.findFirst({ where: { id, addresseeId: userId, status: 'PENDING' } }); if (!row) throw new NotFoundException('Friend request not found.');
    await this.db.friendship.delete({ where: { id } }); return { declined: true };
  }
  async remove(userId: string, friendId: string) {
    const row = await this.db.friendship.findFirst({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId, addresseeId: friendId }, { requesterId: friendId, addresseeId: userId }] } });
    if (!row) throw new NotFoundException('Friendship not found.'); await this.db.friendship.delete({ where: { id: row.id } }); return { removed: true };
  }
  private async findExpense(a: string, b: string, id: string) {
    const row = await this.db.directExpense.findFirst({ where: { id, OR: [{ createdById: a, otherUserId: b }, { createdById: b, otherUserId: a }] } });
    if (!row) throw new NotFoundException('Direct expense not found.'); return row;
  }
  async addDirectExpense(userId: string, friendId: string, body: any) {
    await this.acceptedFriend(userId, friendId);
    const description = String(body.description || '').trim(), amount = Number(body.amountMinor);
    const payerId = body.payerId === friendId ? friendId : body.payerId === userId ? userId : '';
    const myShare = body.myShareMinor === undefined ? Math.floor(amount / 2) : Number(body.myShareMinor);
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (!description || description.length > 120) throw new BadRequestException('Description is required (maximum 120 characters).');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Enter a valid amount in paise.');
    if (!payerId || !Number.isSafeInteger(myShare) || myShare < 0 || myShare > amount) throw new BadRequestException('Choose a valid payer and split.');
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Enter a valid date.');
    const friendShare = amount - myShare;
    const row = await this.db.directExpense.create({ data: { createdById: userId, otherUserId: friendId, payerId, description, amountMinor: BigInt(amount), createdByShareMinor: BigInt(myShare), otherUserShareMinor: BigInt(friendShare), occurredAt } });
    await this.log(userId, friendId, 'DIRECT_EXPENSE_CREATED', { expenseId: row.id, description, amountMinor: amount, payerId, myShareMinor: myShare, friendShareMinor: friendShare });
    await notifyUsers(this.db, [friendId], userId, { type: 'DIRECT_EXPENSE_CREATED', title: 'New friend expense', message: `${description} was added to your shared expenses.`, entityType: 'DIRECT_EXPENSE', entityId: row.id });
    return { ...row, amountMinor: amount, createdByShareMinor: myShare, otherUserShareMinor: friendShare };
  }
  async directExpenses(userId: string, friendId: string) {
    await this.acceptedFriend(userId, friendId);
    const rows = await this.db.directExpense.findMany({ where: { OR: [{ createdById: userId, otherUserId: friendId }, { createdById: friendId, otherUserId: userId }] }, orderBy: { occurredAt: 'desc' }, include: { payer: { select: { id: true, displayName: true } }, createdBy: { select: { id: true, displayName: true } } } });
    return rows.map(x => ({ ...x, amountMinor: Number(x.amountMinor), createdByShareMinor: Number(x.createdByShareMinor ?? BigInt(Math.floor(Number(x.amountMinor) / 2))), otherUserShareMinor: Number(x.otherUserShareMinor ?? BigInt(Number(x.amountMinor) - Math.floor(Number(x.amountMinor) / 2))) }));
  }
  async updateDirectExpense(userId: string, friendId: string, id: string, body: any) {
    await this.acceptedFriend(userId, friendId); const old = await this.findExpense(userId, friendId, id);
    if (old.createdById !== userId) throw new ForbiddenException('Only the person who added this expense can edit it.');
    if (old.deletedAt) throw new BadRequestException('Deleted expenses cannot be edited.');
    const description = String(body.description ?? old.description).trim(), amount = Number(body.amountMinor ?? old.amountMinor);
    const myShare = body.myShareMinor === undefined ? Number(old.createdByShareMinor ?? BigInt(Math.floor(Number(old.amountMinor) / 2))) : Number(body.myShareMinor);
    const payerId = body.payerId ?? old.payerId, occurredAt = body.occurredAt ? new Date(body.occurredAt) : old.occurredAt;
    if (!description || description.length > 120 || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(myShare) || myShare < 0 || myShare > amount || ![userId, friendId].includes(payerId)) throw new BadRequestException('Check the description, amount, payer and split.');
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Enter a valid date.');
    const friendShare = amount - myShare;
    const row = await this.db.directExpense.update({ where: { id }, data: { description, amountMinor: BigInt(amount), createdByShareMinor: BigInt(myShare), otherUserShareMinor: BigInt(friendShare), payerId, occurredAt } });
    await this.log(userId, friendId, 'DIRECT_EXPENSE_UPDATED', { expenseId: id, description, amountMinor: amount, payerId, myShareMinor: myShare, friendShareMinor: friendShare });
    await notifyUsers(this.db, [friendId], userId, { type: 'DIRECT_EXPENSE_UPDATED', title: 'Friend expense updated', message: `${description} was updated.`, entityType: 'DIRECT_EXPENSE', entityId: id });
    return { ...row, amountMinor: amount, createdByShareMinor: myShare, otherUserShareMinor: friendShare };
  }
  async deleteDirectExpense(userId: string, friendId: string, id: string) {
    await this.acceptedFriend(userId, friendId); const old = await this.findExpense(userId, friendId, id);
    if (old.createdById !== userId) throw new ForbiddenException('Only the person who added this expense can delete it.');
    if (old.deletedAt) throw new BadRequestException('This expense is already deleted.');
    await this.db.directExpense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.log(userId, friendId, 'DIRECT_EXPENSE_DELETED', { expenseId: id, description: old.description, amountMinor: Number(old.amountMinor) });
    await notifyUsers(this.db, [friendId], userId, { type: 'DIRECT_EXPENSE_DELETED', title: 'Friend expense deleted', message: `${old.description} was deleted.`, entityType: 'DIRECT_EXPENSE', entityId: id });
    return { deleted: true };
  }
  async addSettlement(userId: string, friendId: string, body: any) {
    await this.acceptedFriend(userId, friendId);
    const payerId = body.payerId === friendId ? friendId : body.payerId === userId ? userId : '';
    const payeeId = payerId === userId ? friendId : payerId === friendId ? userId : '';
    const amount = Number(body.amountMinor), method = ['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'].includes(body.method) ? body.method : 'UPI';
    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (!payerId || !Number.isSafeInteger(amount) || amount <= 0 || Number.isNaN(paidAt.getTime())) throw new BadRequestException('Enter a valid payer, amount and payment date.');
    const row = await this.db.directSettlement.create({ data: { payerId, payeeId, createdById: userId, amountMinor: BigInt(amount), method, note: String(body.note || '').trim() || null, paidAt } });
    await this.log(userId, friendId, 'DIRECT_SETTLEMENT_RECORDED', { settlementId: row.id, payerId, payeeId, amountMinor: amount, method });
    await notifyUsers(this.db, [friendId], userId, { type: 'DIRECT_SETTLEMENT_RECORDED', title: 'Friend payment recorded', message: 'A payment was recorded in your shared expenses.', entityType: 'DIRECT_SETTLEMENT', entityId: row.id });
    return { ...row, amountMinor: amount };
  }
  async settlements(userId: string, friendId: string) {
    await this.acceptedFriend(userId, friendId);
    const rows = await this.db.directSettlement.findMany({ where: { OR: [{ payerId: userId, payeeId: friendId }, { payerId: friendId, payeeId: userId }] }, orderBy: { paidAt: 'desc' }, include: { payer: { select: { id: true, displayName: true } }, payee: { select: { id: true, displayName: true } } } });
    return rows.map(x => ({ ...x, amountMinor: Number(x.amountMinor) }));
  }
  async activity(userId: string, friendId: string) {
    await this.acceptedFriend(userId, friendId);
    return this.db.auditEvent.findMany({ where: { entityType: 'DIRECT_FRIEND', entityId: this.pairKey(userId, friendId) }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: { select: { id: true, displayName: true } } } });
  }
  async balances(userId: string) {
    const friends = await this.list(userId), result: any[] = [];
    for (const item of friends) {
      const friendId = item.friend.id;
      const [expenses, settlements] = await Promise.all([
        this.db.directExpense.findMany({ where: { deletedAt: null, OR: [{ createdById: userId, otherUserId: friendId }, { createdById: friendId, otherUserId: userId }] } }),
        this.db.directSettlement.findMany({ where: { OR: [{ payerId: userId, payeeId: friendId }, { payerId: friendId, payeeId: userId }] } }),
      ]);
      let net = 0;
      for (const e of expenses) {
        const total = Number(e.amountMinor), creatorShare = Number(e.createdByShareMinor ?? BigInt(Math.floor(total / 2)));
        const otherShare = Number(e.otherUserShareMinor ?? BigInt(total - Math.floor(total / 2)));
        const myShare = e.createdById === userId ? creatorShare : otherShare, friendShare = e.createdById === userId ? otherShare : creatorShare;
        net += e.payerId === userId ? friendShare : -myShare;
      }
      for (const s of settlements) net += s.payerId === userId ? Number(s.amountMinor) : -Number(s.amountMinor);
      result.push({ friend: item.friend, netAmountMinor: net });
    }
    return result;
  }
}

@Controller('friends')
@UseGuards(AuthGuard)
export class FriendsController {
  constructor(private friends: FriendsService) {}
  @Get('search') search(@Req() req: any, @Query('q') q: string) { return this.friends.search(req.user.id, q); }
  @Get() list(@Req() req: any) { return this.friends.list(req.user.id); }
  @Get('requests') requests(@Req() req: any) { return this.friends.requests(req.user.id); }
  @Post('requests') send(@Req() req: any, @Body() body: any) { return this.friends.sendRequest(req.user.id, body.email); }
  @Post('requests/:id/accept') accept(@Req() req: any, @Param('id') id: string) { return this.friends.accept(req.user.id, id); }
  @Delete('requests/:id') decline(@Req() req: any, @Param('id') id: string) { return this.friends.decline(req.user.id, id); }
  @Delete(':friendId') remove(@Req() req: any, @Param('friendId') id: string) { return this.friends.remove(req.user.id, id); }
  @Get('balances') balances(@Req() req: any) { return this.friends.balances(req.user.id); }
  @Get(':friendId/expenses') directExpenses(@Req() req: any, @Param('friendId') id: string) { return this.friends.directExpenses(req.user.id, id); }
  @Post(':friendId/expenses') addDirectExpense(@Req() req: any, @Param('friendId') id: string, @Body() body: any) { return this.friends.addDirectExpense(req.user.id, id, body); }
  @Put(':friendId/expenses/:expenseId') update(@Req() req: any, @Param('friendId') friendId: string, @Param('expenseId') expenseId: string, @Body() body: any) { return this.friends.updateDirectExpense(req.user.id, friendId, expenseId, body); }
  @Delete(':friendId/expenses/:expenseId') delete(@Req() req: any, @Param('friendId') friendId: string, @Param('expenseId') expenseId: string) { return this.friends.deleteDirectExpense(req.user.id, friendId, expenseId); }
  @Get(':friendId/settlements') settlements(@Req() req: any, @Param('friendId') id: string) { return this.friends.settlements(req.user.id, id); }
  @Post(':friendId/settlements') addSettlement(@Req() req: any, @Param('friendId') id: string, @Body() body: any) { return this.friends.addSettlement(req.user.id, id, body); }
  @Get(':friendId/activity') activity(@Req() req: any, @Param('friendId') id: string) { return this.friends.activity(req.user.id, id); }
}
export const friendsProviders = [FriendsService];
