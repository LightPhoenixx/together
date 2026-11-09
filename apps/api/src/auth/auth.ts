import { Body, Controller, Post, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService) {}
  async signup(body: any) {
    const name = String(body.name ?? '').trim(); const email = String(body.email ?? '').trim().toLowerCase(); const password = String(body.password ?? '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) throw new BadRequestException('Enter a name, valid email and password of at least 8 characters.');
    if (await this.db.user.findUnique({ where: { email } })) throw new BadRequestException('An account with this email already exists.');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.db.user.create({ data: { authSubject: `local:${email}`, displayName: name, email, passwordHash } as any, select: { id: true, displayName: true, email: true } });
    return this.session(user);
  }
  async login(body: any) {
    const email = String(body.email ?? '').trim().toLowerCase(); const password = String(body.password ?? '');
    const user = await this.db.user.findUnique({ where: { email } }) as any;
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Email or password is incorrect.');
    return this.session({ id: user.id, displayName: user.displayName, email: user.email });
  }
  private async session(user: { id: string; displayName: string; email: string | null }) {
    return { token: await this.jwt.signAsync({ sub: user.id, email: user.email }), user };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('signup') signup(@Body() body: any) { return this.auth.signup(body); }
  @Post('login') login(@Body() body: any) { return this.auth.login(body); }
}
export const authProviders = [AuthService];
