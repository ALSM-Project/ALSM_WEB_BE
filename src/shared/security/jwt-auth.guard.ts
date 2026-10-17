import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RequestWithContext } from '../logging/request-id.middleware';
import { RequireCurrentSessionService } from '../../modules/auth/application/require-current-session.service';
import { PASSWORD_REMEDIATION } from './password-remediation.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: RequireCurrentSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Access token is required',
      });
    }

    let payload: {
      sub: string;
      email: string;
      isPlatformAdmin: boolean;
      sid?: string;
      sv?: string;
    };
    try {
      payload = await this.jwt.verifyAsync<typeof payload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
      });
    }
    // A signed user token is not proof of a live session. Keep authoritative
    // assurance outside the JWT catch so storage outages retain their safe 503.
    const remediation = Reflect.getMetadata(PASSWORD_REMEDIATION, context.getHandler()) === true;
    await this.sessions.execute(payload.sub, payload.sid, payload.sv, remediation);
    request.user = {
      userId: payload.sub,
      email: payload.email,
      isPlatformAdmin: payload.isPlatformAdmin,
      sessionId: payload.sid,
      sessionVersion: payload.sv,
    };
    return true;
  }
}
