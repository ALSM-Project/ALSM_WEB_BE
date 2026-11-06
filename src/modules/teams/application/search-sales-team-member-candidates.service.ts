import { Injectable } from '@nestjs/common';
import { RbacService } from '../../rbac/application/rbac.service';
import { TeamAccessService } from './team-access.service';

const SALES_ROLES = new Set(['SALES_MANAGER', 'SALES_VP', 'INTERNAL_SALES', 'SALES_REP']);

@Injectable()
export class SearchSalesTeamMemberCandidatesService {
  constructor(
    private readonly access: TeamAccessService,
    private readonly rbac: RbacService,
  ) {}

  async execute(userId: string, organizationHeader: string | undefined, query: string) {
    const organization = await this.access.administer(userId, organizationHeader);
    const search = query.trim().toLocaleLowerCase();
    const currentMemberIds = new Set(organization.members.map((member) => member.userId));
    const users = await this.rbac.getAllUsers();

    return users
      .filter((user) =>
        user.isActive &&
        !currentMemberIds.has(user.id) &&
        user.roles.some((role) => SALES_ROLES.has(role)) &&
        `${user.fullName} ${user.email}`.toLocaleLowerCase().includes(search),
      )
      .slice(0, 30)
      .map(({ id, fullName, email }) => ({ id, fullName, email }));
  }
}
