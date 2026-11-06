import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { TeamAccessService } from './team-access.service';

export interface OrganizationTeamMember {
  id: string;
  fullName: string;
  email: string;
  organizationRole: OrganizationRole;
}

@Injectable()
export class ListOrganizationTeamMembersService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(userId: string, organizationHeader?: string): Promise<OrganizationTeamMember[]> {
    const organization = await this.access.administer(userId, organizationHeader);
    const members: OrganizationTeamMember[] = [];
    for (const member of organization.members) {
      const account = await this.users.findById(member.userId);
      if (!account?.isActive) continue;
      members.push({
        id: account.id,
        fullName: account.fullName,
        email: account.email,
        organizationRole: member.role,
      });
    }
    return members.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }
}
