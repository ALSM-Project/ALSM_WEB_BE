import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { RbacService } from '../../rbac/application/rbac.service';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { TeamAccessService, teamId } from './team-access.service';

const SALES_ROLES = new Set(['SALES_MANAGER', 'SALES_VP', 'INTERNAL_SALES', 'SALES_REP']);

@Injectable()
export class AddExistingSalesTeamMembersService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly rbac: RbacService,
  ) {}

  async execute(userId: string, organizationHeader: string | undefined, requestedIds: string[]) {
    const organization = await this.access.administer(userId, organizationHeader);
    if (!requestedIds.length || requestedIds.length > 100)
      throw new BadRequestException({
        code: 'INVALID_SALES_TEAM_MEMBERS',
        message: 'Select between 1 and 100 existing Sales accounts',
      });

    const userIds = requestedIds.map(teamId);
    if (new Set(userIds).size !== userIds.length)
      throw new BadRequestException({
        code: 'INVALID_SALES_TEAM_MEMBERS',
        message: 'Sales accounts must be unique',
      });

    const accounts = await Promise.all(userIds.map((id) => this.users.findById(id)));
    for (let index = 0; index < userIds.length; index += 1) {
      const account = accounts[index];
      if (!account?.isActive)
        throw new NotFoundException({
          code: 'SALES_ACCOUNT_NOT_FOUND',
          message: 'An active Sales account could not be found',
        });
      const roles = await this.rbac.getUserRoles(userIds[index]);
      if (!roles.some((role) => SALES_ROLES.has(role)))
        throw new BadRequestException({
          code: 'NOT_AN_INTERNAL_SALES_ACCOUNT',
          message: 'Only active internal Sales accounts can be added this way',
        });
    }

    const additions = userIds.filter(
      (id) => !organization.members.some((member) => member.userId === id),
    );
    if (additions.length) {
      await this.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'SALES_TEAM_ORGANIZATION_MEMBERS_ADD_REQUESTED',
        resourceType: 'organization',
        resourceId: organization.id,
        metadata: { memberCount: String(additions.length) },
      });

      for (const id of additions) {
        await this.organizations.addMember(organization.id, {
          userId: id,
          role: OrganizationRole.MEMBER,
        });
      }

      await this.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'SALES_TEAM_ORGANIZATION_MEMBERS_ADDED',
        resourceType: 'organization',
        resourceId: organization.id,
        metadata: { memberCount: String(additions.length) },
      });
    }

    return additions.map((id) => {
      const account = accounts[userIds.indexOf(id)]!;
      return { id, fullName: account.fullName, email: account.email, organizationRole: OrganizationRole.MEMBER };
    });
  }
}
