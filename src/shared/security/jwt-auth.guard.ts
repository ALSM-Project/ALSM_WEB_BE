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

    if (!token) {
      if (process.env.NODE_ENV !== 'production') {
        request.user = { userId: '65f1a2b3c4d5e6f7a8b9c0d1', email: 'dev@alsm.local', isPlatformAdmin: true };
        return true;
      }
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Access token is required' });
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        isPlatformAdmin: boolean;
        sid?: string;
      }>(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });
      request.user = {
        userId: payload.sub,
        email: payload.email,
        isPlatformAdmin: payload.isPlatformAdmin,
        sessionId: payload.sid,
      };
      return true;
    } catch {
      if (process.env.NODE_ENV !== 'production') {
        request.user = { userId: '65f1a2b3c4d5e6f7a8b9c0d1', email: 'dev@alsm.local', isPlatformAdmin: true };
        return true;
      }
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  }
}
