import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Please log in');
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7));
      request.user = { id: payload.sub, email: payload.email };
      return true;
    } catch { throw new UnauthorizedException('Your session has expired. Please log in again.'); }
  }
}
