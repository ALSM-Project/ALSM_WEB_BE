import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrganizationRecord } from '../domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../domain/organization.types';

@Injectable()
export class OrganizationAuthorizationService {
  require(organization: OrganizationRecord, userId: string, allowed: (OrganizationRole | string)[]): void {
    const member = organization.members.find((m) => m.userId === userId);
    const role = member?.role as string | undefined;
    if (!role) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'Your organization role cannot perform this action',
      });
    }

    const isOwner =
      role === OrganizationRole.OWNER ||
      role === OrganizationRole.ORGANIZATION_OWNER ||
      role === 'ORGANIZATION_OWNER';
    const isAdmin =
      isOwner ||
      role === OrganizationRole.ADMIN ||
      role === 'ADMIN' ||
      role === 'ORGANIZATION_ADMIN' ||
      role === 'ENTERPRISE_ADMIN';
    const isMember = isAdmin || role === OrganizationRole.MEMBER || role === 'MEMBER';

    const hasPermission = allowed.some((allowedRole) => {
      if (allowedRole === role) return true;
      if (
        (allowedRole === OrganizationRole.OWNER || allowedRole === OrganizationRole.ORGANIZATION_OWNER) &&
        isOwner
      ) {
        return true;
      }
      if (allowedRole === OrganizationRole.ADMIN && isAdmin) return true;
      if (allowedRole === OrganizationRole.MEMBER && isMember) return true;
      if (allowedRole === OrganizationRole.VIEWER) return true;
      return false;
    });

    if (!hasPermission) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'Your organization role cannot perform this action',
      });
    }
  }
}
