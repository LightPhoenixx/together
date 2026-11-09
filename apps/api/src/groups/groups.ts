import { Body, Controller, Get, Injectable, Param, Post, Req, UseGuards, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../common/auth.guard';

@Injectable()
class GroupsService {
  constructor(private db: PrismaService) {}
  async list(userId: string) { return this.db.group.findMany({ where: { members: { some: { userId } } }, include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } }, _count: { select: { expenses: true } } }, orderBy: { updatedAt: 'desc' } }); }
  async create(userId: string, body: any) {
    const name = String(body.name ?? '').trim(); if (name.length < 2) throw new BadRequestException('Group name must contain at least 2 characters.');
    const memberIds = [...new Set([userId, ...(Array.isArray(body.memberIds) ? body.memberIds : [])])];
    const users = await this.db.user.findMany({ where: { id: { in: memberIds } }, select: { id: true } });
    if (users.length !== memberIds.length) throw new BadRequestException('One or more members do not exist.');
    return this.db.group.create({ data: { name, description: body.description || null, currency: body.currency || 'INR', createdById: userId, members: { create: memberIds.map(id => ({ userId: id, role: id === userId ? 'OWNER' : 'MEMBER' })) } }, include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } } } });
  }
  async addMember(userId: string, groupId: string, email: string) {
    const group = await this.db.group.findUnique({ where: { id: groupId }, include: { members: true } }); if (!group) throw new NotFoundException('Group not found.');
    if (!group.members.some(m => m.userId === userId)) throw new ForbiddenException();
    const person = await this.db.user.findUnique({ where: { email: email.toLowerCase() } }); if (!person) throw new NotFoundException('No Together account found for that email. Ask them to sign up first.');
    await this.db.groupMember.upsert({ where: { groupId_userId: { groupId, userId: person.id } }, create: { groupId, userId: person.id }, update: {} });
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
}
export const groupsProviders = [GroupsService];
