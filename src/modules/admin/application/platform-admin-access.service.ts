import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';
import {
  IRbacRepository,
  IRbacUser,
  RBAC_REPOSITORY,
} from '../../rbac/domain/rbac.repository.interface';

export const TRANSFER_EXECUTION_PERMISSIONS = ['resources.transfer', 'resources.transfer.confirm'];

export function adminAuthorizationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'PLATFORM_ADMIN_AUTHORIZATION_UNAVAILABLE',
    message: 'Platform administration authorization could not be verified',
  });
}

/** Global administration is distinct from ordinary tenant/team or support access. */
@Injectable()
export class PlatformAdminAccessService {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbac: IRbacRepository,
    private readonly permissions: EffectivePermissionsService,
  ) {}

  async authorize(userId: string, requiredPermissions: string[]): Promise<void> {
    // Missing policy must not inherit PermissionsGuard's ordinary allow default.
    if (!requiredPermissions.length) throw adminAuthorizationUnavailable();
    const denied = () =>
      new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    let user: IRbacUser | null;
    try {
      user = await this.rbac.findUserById(userId);
    } catch {
      throw adminAuthorizationUnavailable();
    }
    if (
      !user ||
      user.id !== userId ||
      user.isPlatformAdmin !== true ||
      user.isActive !== true ||
      user.isLocked !== false
    ) {
      throw denied();
    }
    let effective: string[];
    try {
      effective = await this.permissions.getEffectivePermissions(userId);
      if (!Array.isArray(effective)) throw adminAuthorizationUnavailable();
    } catch {
      throw adminAuthorizationUnavailable();
    }
    if (!requiredPermissions.every((permission) => effective.includes(permission))) throw denied();
  }
}
