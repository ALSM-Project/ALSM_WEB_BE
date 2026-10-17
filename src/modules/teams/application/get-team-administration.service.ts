import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TEAM_REPOSITORY, TeamRepository } from '../domain/team.types';
import { TeamAccessService, teamId } from './team-access.service';

@Injectable()
export class GetTeamAdministrationService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
  ) {}
  async execute(userId: string, organizationHeader: string | undefined, id: string) {
    const organization = await this.access.administer(userId, organizationHeader);
    const team = await this.teams.findById(teamId(id), organization.id);
    if (!team)
      throw new NotFoundException({ code: 'TEAM_NOT_FOUND', message: 'Team is unavailable' });
    return team;
  }
}
