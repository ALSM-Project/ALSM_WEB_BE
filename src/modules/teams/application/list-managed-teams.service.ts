import { Inject, Injectable } from '@nestjs/common';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../domain/team.types';
import { TeamAccessService } from './team-access.service';

@Injectable()
export class ListManagedTeamsService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
  ) {}
  async execute(userId: string, organizationHeader: string | undefined, kind: TeamKind) {
    const organization = await this.access.organization(userId, organizationHeader);
    const teams = await this.teams.listManaged(organization.id, userId, kind);
    return teams.map((team) => ({
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      kind: team.kind,
      revision: team.revision,
    }));
  }
}
