import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { OrganizationRecord } from '../../organizations/domain/organization.repository';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../domain/team.types';

export function teamId(value: string): string {
  if (!/^[a-fA-F0-9]{24}$/.test(value))
    throw new BadRequestException({
      code: 'INVALID_TEAM_IDENTIFIER',
      message: 'A canonical MongoDB identifier is required',
    });
  return value.toLowerCase();
}

@Injectable()
export class TeamAccessService {
  constructor(
    private readonly context: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly permissions: EffectivePermissionsService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
  ) {}

  async organization(userId: string, organizationHeader?: string): Promise<OrganizationRecord> {
    teamId(userId);
    const user = await this.users.findById(userId);
    if (!user?.isActive)
      throw new ForbiddenException({
        code: 'TEAM_ACCESS_DENIED',
        message: 'An active account is required',
      });
    return this.context.resolve(
      userId,
      organizationHeader ? teamId(organizationHeader) : undefined,
    );
  }

  async administer(userId: string, organizationHeader?: string): Promise<OrganizationRecord> {
    const organization = await this.organization(userId, organizationHeader);
    this.authorization.require(organization, userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
    ]);
    if (!(await this.permissions.getEffectivePermissions(userId)).includes('users.manage')) {
      throw new ForbiddenException({
        code: 'TEAM_ADMINISTRATION_DENIED',
        message: 'Organization administration and users.manage are both required',
      });
    }
    return organization;
  }

  async managed(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    kind: TeamKind,
  ) {
    const organization = await this.organization(userId, organizationHeader);
    const team = await this.teams.findManaged(teamId(id), organization.id, userId, kind);
    if (!team)
      throw new NotFoundException({
        code: 'TEAM_NOT_FOUND',
        message: 'Team is unavailable in your management scope',
      });
    return { organization, team };
  }
}
