import { Body, Controller, Get, Injectable, Param, Post, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';
import { notifyUsers } from '../common/notifications';

@Injectable()
class GroupsService {
  constructor(private db: PrismaService) {}
  async list(userId: string) { return this.db.group.findMany({ where: { members: { some: { userId } } }, include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } }, _count: { select: { expenses: true } } }, orderBy: { updatedAt: 'desc' } }); }
  async create(userId: string, body: any) {
    const name = String(body.name ?? '').trim(); if (name.length < 2) throw new BadRequestException('Group name must contain at least 2 characters.');
    const currency = String(body.currency || 'INR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Group currency must be a 3-letter ISO code.');
    const memberIds = [...new Set([userId, ...(Array.isArray(body.memberIds) ? body.memberIds : [])])];
    const users = await this.db.user.findMany({ where: { id: { in: memberIds } }, select: { id: true } });
    if (users.length !== memberIds.length) throw new BadRequestException('One or more members do not exist.');
    const created = await this.db.group.create({ data: { name, description: body.description || null, currency, createdById: userId, members: { create: memberIds.map(id => ({ userId: id, role: id === userId ? 'OWNER' : 'MEMBER' })) } }, include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } } } });
    await this.db.auditEvent.create({
      data: { actorId: userId, entityType: 'GROUP', entityId: created.id, action: 'GROUP_CREATED', afterData: { name: created.name } },
    });
    return created;
  }
  async activity(userId: string, groupId: string) {
    const member = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!member) throw new ForbiddenException();
    return this.db.auditEvent.findMany({
      where: { entityType: 'GROUP', entityId: groupId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async addMember(userId: string, groupId: string, email: string) {
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } }); if (!group) throw new NotFoundException('Group not found.');
    if (!group.members.some(m => m.userId === userId)) throw new ForbiddenException();
    const person = await this.db.user.findUnique({ where: { email: email.toLowerCase() } }); if (!person) throw new NotFoundException('No Together account found for that email. Ask them to sign up first.');
    const existing = await this.db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: person.id } } });
    await this.db.groupMember.upsert({ where: { groupId_userId: { groupId, userId: person.id } }, create: { groupId, userId: person.id }, update: {} });
    if (!existing) {
      await this.db.auditEvent.create({
        data: { actorId: userId, entityType: 'GROUP', entityId: groupId, action: 'MEMBER_ADDED', afterData: { userId: person.id, displayName: person.displayName } },
      });
      await notifyUsers(this.db, [person.id], userId, { type: 'GROUP_MEMBER_ADDED', title: 'Added to a group', message: `You were added to ${group.name}.`, groupId, entityType: 'GROUP', entityId: groupId });
    }
    return { added: true, user: { id: person.id, displayName: person.displayName, email: person.email } };
  }
}
@Controller('groups')
@UseGuards(AuthGuard)
export class GroupsController {
  constructor(private groups: GroupsService) {}
  @Get() list(@Req() req: any) { return this.groups.list(req.user.id); }
  @Post() create(@Req() req: any, @Body() body: any) { return this.groups.create(req.user.id, body); }
  @Post(':id/members') addMember(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.groups.addMember(req.user.id, id, String(body.email ?? '').trim()); }
  @Get(':id/activity') activity(@Req() req: any, @Param('id') id: string) { return this.groups.activity(req.user.id, id); }
}
export const groupsProviders = [GroupsService];
