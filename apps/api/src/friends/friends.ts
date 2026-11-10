import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';

@Injectable()
class FriendsService {
  constructor(private db: PrismaService) {}

  private async acceptedFriend(userId: string, friendId: string) {
    const friendship = await this.db.friendship.findFirst({
      where: { status: 'ACCEPTED', OR: [
        { requesterId: userId, addresseeId: friendId },
        { requesterId: friendId, addresseeId: userId },
      ] },
    });
    if (!friendship) throw new ForbiddenException('You can only share direct expenses with an accepted friend.');
  }

  async search(userId: string, q: string) {
    const term = String(q || '').trim();
    if (term.length < 2) return [];
    return this.db.user.findMany({
      where: { id: { not: userId }, OR: [
        { email: { contains: term, mode: 'insensitive' } },
        { displayName: { contains: term, mode: 'insensitive' } },
      ] },
      select: { id: true, displayName: true, email: true },
      take: 10,
    });
  }

  async list(userId: string) {
    const rows = await this.db.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: { requester: { select: { id: true, displayName: true, email: true } }, addressee: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new BadRequestException('Enter an email address.');
    const target = await this.db.user.findUnique({ where: { email: normalized } });
    if (!target) throw new NotFoundException('No Together account found for that email.');
    if (target.id === userId) throw new BadRequestException('You cannot add yourself as a friend.');
    const existing = await this.db.friendship.findFirst({ where: { OR: [
      { requesterId: userId, addresseeId: target.id },
      { requesterId: target.id, addresseeId: userId },
    ] } });
    if (existing?.status === 'ACCEPTED') throw new BadRequestException('You are already friends.');
    if (existing?.requesterId === target.id) throw new BadRequestException('This person has already sent you a request. Accept it from incoming requests.');
    if (existing) return { id: existing.id, status: existing.status };
    const row = await this.db.friendship.create({ data: { requesterId: userId, addresseeId: target.id } });
    return { id: row.id, status: row.status };
  }

  async accept(userId: string, requestId: string) {
    const row = await this.db.friendship.findFirst({ where: { id: requestId, addresseeId: userId, status: 'PENDING' } });
    if (!row) throw new NotFoundException('Friend request not found.');
    return this.db.friendship.update({ where: { id: row.id }, data: { status: 'ACCEPTED' } });
  }

  async decline(userId: string, requestId: string) {
    const row = await this.db.friendship.findFirst({ where: { id: requestId, addresseeId: userId, status: 'PENDING' } });
    if (!row) throw new NotFoundException('Friend request not found.');
    await this.db.friendship.delete({ where: { id: row.id } });
    return { declined: true };
  }

  async remove(userId: string, friendId: string) {
    const row = await this.db.friendship.findFirst({ where: { status: 'ACCEPTED', OR: [
      { requesterId: userId, addresseeId: friendId },
      { requesterId: friendId, addresseeId: userId },
    ] } });
    if (!row) throw new NotFoundException('Friendship not found.');
    await this.db.friendship.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async addDirectExpense(userId: string, friendId: string, body: any) {
    await this.acceptedFriend(userId, friendId);
    const description = String(body.description || '').trim();
    const amountMinor = Number(body.amountMinor);
    const payerId = body.payerId === friendId ? friendId : body.payerId === userId ? userId : '';
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (!description || description.length > 120) throw new BadRequestException('Description is required (maximum 120 characters).');
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new BadRequestException('Enter a valid amount in paise.');
    if (!payerId) throw new BadRequestException('Payer must be you or your friend.');
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('Enter a valid date.');
    const row = await this.db.directExpense.create({ data: { createdById: userId, payerId, otherUserId: friendId, description, amountMinor: BigInt(amountMinor), occurredAt } });
    return { ...row, amountMinor: Number(row.amountMinor) };
  }

  async directExpenses(userId: string, friendId: string) {
    await this.acceptedFriend(userId, friendId);
    const rows = await this.db.directExpense.findMany({
      where: { OR: [{ payerId: userId, otherUserId: friendId }, { payerId: friendId, otherUserId: userId }] },
      orderBy: { occurredAt: 'desc' },
      include: { payer: { select: { id: true, displayName: true } }, createdBy: { select: { id: true, displayName: true } } },
    });
    return rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor) }));
  }

  async balances(userId: string) {
    const friends = await this.list(userId);
    const result = [];
    for (const item of friends) {
      const friendId = item.friend.id;
      const expenses = await this.db.directExpense.findMany({ where: { OR: [
        { payerId: userId, otherUserId: friendId },
        { payerId: friendId, otherUserId: userId },
      ] } });
      let net = 0;
      for (const expense of expenses) {
        const otherShare = Math.floor(Number(expense.amountMinor) / 2);
        net += expense.payerId === userId ? otherShare : -otherShare;
      }
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
}
export const friendsProviders = [FriendsService];
