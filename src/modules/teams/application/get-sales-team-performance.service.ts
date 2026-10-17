import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { TeamKind } from '../domain/team.types';
import { reportingPeriod } from '../domain/reporting-period';
import {
  SALES_PERFORMANCE_SOURCE,
  SalesPerformanceSource,
  summarizeSales,
} from '../../crm/domain/sales-performance-source.port';
import { TeamAccessService } from './team-access.service';

@Injectable()
export class GetSalesTeamPerformanceService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SALES_PERFORMANCE_SOURCE) private readonly source: SalesPerformanceSource,
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
    const period = reportingPeriod(days, asOf);
    const records = await this.source.read(
      organization.id,
      team.id,
      new Date(period.start),
      new Date(period.end),
    );
    // Historical contributors are authorized by retained team-owned business records,
    // never inferred from today's roster. Current roster remains visible at zero.
    const historical = new Set([
      ...records.leads.flatMap((lead) => lead.memberIds),
      ...records.revenue.map((row) => row.memberId),
    ]);
    const people = new Map<string, { fullName: string; currentMember: boolean }>();
    for (const memberId of new Set([...team.memberIds, ...historical])) {
      const user = await this.users.findById(memberId);
      const currentMember = Boolean(
        user?.isActive &&
        team.memberIds.includes(memberId) &&
        organization.members.some((member) => member.userId === memberId),
      );
      if (currentMember || historical.has(memberId))
        people.set(memberId, {
          fullName: user?.fullName ?? 'Historical salesperson',
          currentMember,
        });
    }
    const calculated = summarizeSales(records, [...people.keys()]);
    const members = calculated.members.map((member) => ({
      ...member,
      ...people.get(member.userId)!,
    }));
    const current = await this.access.managed(userId, organization.id, team.id, TeamKind.SALES);
    if (
      current.team.revision !== team.revision ||
      JSON.stringify(current.organization.members) !== JSON.stringify(organization.members)
    )
      throw new ConflictException({
        code: 'TEAM_REPORT_CHANGED',
        message: 'Team changed while reporting; refresh',
      });
    return {
      team: { id: team.id, name: team.name, kind: team.kind, organizationId: organization.id },
      period,
      asOf: asOf.toISOString(),
      metrics: calculated.metrics,
      cohort: 'ASSIGNMENT_START' as const,
      conversionCredit: 'ASSIGNEE_AT_CONVERSION' as const,
      revenueBasis: 'CONFIRMED_PAYMENTS_WITH_EXPLICIT_SALESPERSON' as const,
      coverage: 'RECORDED_EXPLICIT_SALES_ASSIGNMENTS' as const,
      members,
    };
  }
}
