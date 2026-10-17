import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { RequireCurrentSessionService } from '../../modules/auth/application/require-current-session.service';
import { RequestWithContext } from '../logging/request-id.middleware';

@Injectable()
export class CurrentSessionGuard implements CanActivate {
  constructor(private readonly assurance: RequireCurrentSessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actor = context.switchToHttp().getRequest<RequestWithContext>().user;
    if (!actor) throw new UnauthorizedException();
    await this.assurance.execute(actor.userId, actor.sessionId, actor.sessionVersion);
    return true;
  }
}
