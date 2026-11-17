import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './require-permissions.decorator';
import { EffectivePermissionsService } from '../../modules/rbac/application/effective-permissions.service';
import { RequestWithContext } from '../logging/request-id.middleware';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    private readonly effectivePermissionsService?: EffectivePermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const anyPermissions = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!anyPermissions || anyPermissions.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Access token is required',
      });
    }

    const userPermissions = this.effectivePermissionsService ? await this.effectivePermissionsService.getEffectivePermissions(userId) : [];

    // Rule: User must possess AT LEAST ONE of anyPermissions if specified
    if (anyPermissions && anyPermissions.length > 0) {
      const hasAny = anyPermissions.some((perm) => userPermissions.includes(perm));
      if (!hasAny) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action',
        });
      }
    }

    // Rule: User must possess ALL required permissions if specified
    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasAll = requiredPermissions.every((perm) => userPermissions.includes(perm));
      if (!hasAll) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action',
        });
      }
    }

    return true;
  }
}
