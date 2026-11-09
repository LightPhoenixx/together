import { Controller, Get, Injectable, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
@Injectable()
class UsersService { constructor(private db: PrismaService) {} async me(id: string) { return this.db.user.findUnique({ where: { id }, select: { id: true, displayName: true, email: true, defaultCurrency: true } }); } async friends(id: string) { const groups = await this.db.groupMember.findMany({ where: { userId: id }, select: { groupId: true } }); const ids = groups.map(g => g.groupId); const members = await this.db.groupMember.findMany({ where: { groupId: { in: ids }, userId: { not: id } }, distinct: ['userId'], include: { user: { select: { id: true, displayName: true, email: true } } } }); return members.map(m => m.user); } }
@Controller('users') @UseGuards(AuthGuard)
export class UsersController { constructor(private users: UsersService) {} @Get('me') me(@Req() req: any) { return this.users.me(req.user.id); } @Get('friends') friends(@Req() req: any) { return this.users.friends(req.user.id); } }
export const usersProviders = [UsersService];
