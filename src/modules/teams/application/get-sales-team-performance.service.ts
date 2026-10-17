import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { TeamKind } from '../domain/team.types';
import { reportingPeriod, unavailableSalesMetrics } from '../domain/reporting-period';
import { TeamAccessService } from './team-access.service';

@Injectable()
export class GetSalesTeamPerformanceService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    teamId: string,
    days: number,
  ) {
    const { team, organization } = await this.access.managed(
      userId,
      organizationHeader,
      teamId,
      TeamKind.SALES,
    );
    const asOf = new Date();
    if (days !== 7 && days !== 30)
      throw new BadRequestException({
        code: 'INVALID_REPORTING_PERIOD',
        message: 'Choose 7 or 30 days',
      });
    const members: {
      userId: string;
      fullName: string;
      metrics: ReturnType<typeof unavailableSalesMetrics>;
    }[] = [];
    for (const memberId of team.memberIds) {
      if (!organization.members.some((m) => m.userId === memberId)) continue;
      const user = await this.users.findById(memberId);
      if (user?.isActive)
        members.push({
          userId: memberId,
          fullName: user.fullName,
          metrics: unavailableSalesMetrics(),
        });
    }
    const current = await this.access.managed(userId, organization.id, team.id, TeamKind.SALES);
    if (current.team.revision !== team.revision)
      throw new ConflictException({
        code: 'TEAM_REPORT_CHANGED',
        message: 'Team changed while reporting; refresh',
      });
    return {
      team: { id: team.id, name: team.name, kind: team.kind, organizationId: organization.id },
      period: reportingPeriod(days, asOf),
      asOf: asOf.toISOString(),
      metrics: unavailableSalesMetrics(),
      members,
    };
  }
}
