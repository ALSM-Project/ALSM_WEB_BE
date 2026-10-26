import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TeamAccessService, teamId } from './team-access.service';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../domain/team.types';
import { SalesTeamAdministration } from '../domain/sales-team-administration.port';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';

/** Public authorization facade for organization-owned Sales business records. */
@Injectable()
export class SalesTeamAdministrationService implements SalesTeamAdministration {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
  ) {}
  async organization(userId: string, organizationHeader: string | undefined) {
    return { organizationId: (await this.access.administer(userId, organizationHeader)).id };
  }
  async authorize(
    userId: string,
    organizationHeader: string | undefined,
    selectedTeamId: string,
    salespersonId?: string,
  ) {
    const organization = await this.access.administer(userId, organizationHeader);
    const team = await this.teams.findById(teamId(selectedTeamId), organization.id);
    if (!team || team.kind !== TeamKind.SALES)
      throw new NotFoundException({
        code: 'SALES_TEAM_NOT_FOUND',
        message: 'Sales team is unavailable in this organization',
      });
    if (salespersonId) {
      teamId(salespersonId);
      if (
        !team.memberIds.includes(salespersonId) ||
        !organization.members.some((member) => member.userId === salespersonId) ||
        !(await this.users.findById(salespersonId))?.isActive
      )
        throw new BadRequestException({
          code: 'INVALID_SALESPERSON',
          message: 'An active explicit salesperson in this team and organization is required',
        });
    }
    return { organizationId: organization.id };
  }
  async customer(organizationId: string, customerUserId: string) {
    teamId(customerUserId);
    const organization = await this.organizations.findForMember(organizationId, customerUserId);
    return Boolean(
      organization?.members.some((member) => member.userId === customerUserId) &&
      (await this.users.findById(customerUserId))?.isActive,
    );
  }
}
