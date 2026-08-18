import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RequestWithContext } from '../logging/request-id.middleware';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Access token is required' });
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; isPlatformAdmin: boolean }>(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });
      request.user = { userId: payload.sub, email: payload.email, isPlatformAdmin: payload.isPlatformAdmin };
      return true;
    } catch { throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid or expired access token' }); }
  }
}
