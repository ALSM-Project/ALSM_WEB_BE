import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithContext } from '../../../shared/logging/request-id.middleware';
import { PERMISSIONS_KEY } from '../../../shared/security/require-permissions.decorator';
import {
  adminAuthorizationUnavailable,
  PlatformAdminAccessService,
  TRANSFER_EXECUTION_PERMISSIONS,
} from '../application/platform-admin-access.service';

const DISABLED_IMPERSONATION = Symbol('disabled-impersonation');
const OFFBOARDING_TRANSFER = Symbol('offboarding-transfer');

// This exception preserves only the permanently rejecting impersonation handler.
// It is server metadata, never a request-controlled authorization switch.
export const DisabledSupportImpersonation = () => SetMetadata(DISABLED_IMPERSONATION, true);
export const CheckOffboardingTransfer = () => SetMetadata(OFFBOARDING_TRANSFER, true);

@Injectable()
export class PlatformAdminAuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: PlatformAdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.user?.userId) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Access token is required',
      });
    }
    const handler = context.getHandler();
    if (this.reflector.get<boolean>(DISABLED_IMPERSONATION, handler)) return true;

    const required = this.reflector.get<string[]>(PERMISSIONS_KEY, handler);
    if (!required?.length) throw adminAuthorizationUnavailable();
    const permissions = [...required];
    // Match the service's transfer branch so offboarding cannot bypass execution
    // authorization by embedding a transfer in a different endpoint.
    if (
      this.reflector.get<boolean>(OFFBOARDING_TRANSFER, handler) &&
      request.body?.transferToUserId
    ) {
      permissions.push(...TRANSFER_EXECUTION_PERMISSIONS);
    }
    await this.access.authorize(request.user.userId, permissions);
    return true;
  }
}
