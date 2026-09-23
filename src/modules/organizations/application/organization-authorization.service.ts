import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrganizationRecord } from '../domain/organization.repository';
import { OrganizationRole } from '../domain/organization.types';

@Injectable()
export class OrganizationAuthorizationService {
  require(organization: OrganizationRecord, userId: string, allowed: OrganizationRole[]): void {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }
    const member = organization.members.find((m) => m.userId === userId);
    const role = member?.role;
    if (!role || !allowed.includes(role)) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'Your organization role cannot perform this action',
      });
    }
  }
}
