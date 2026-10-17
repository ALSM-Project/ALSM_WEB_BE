import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { GetSalesTeamPerformanceService } from '../application/get-sales-team-performance.service';
import { TeamPeriodQuery } from './team.dto';
import { GetTeamWorkloadService } from '../application/get-team-workload.service';

@ApiTags('Team reports')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('teams/:teamId')
export class TeamReportsController {
  constructor(
    private readonly sales: GetSalesTeamPerformanceService,
    private readonly workload: GetTeamWorkloadService,
  ) {}
  @Get('workload')
  @ApiOperation({
    summary:
      'Team Lead: current statuses of explicitly assigned jobs created in the last 7/30 rolling days; no historical attribution inferred',
  })
  monitor(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
    @Query() query: TeamPeriodQuery,
  ) {
    return this.workload.execute(user.userId, organizationId, teamId, query.days);
  }
  @Get('performance')
  @ApiOperation({
    summary:
      'Sales Manager: assignment-start lead cohort, actual conversion credit and explicitly attributed confirmed payments; 7/30 rolling days',
  })
  performance(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
    @Query() query: TeamPeriodQuery,
  ) {
    return this.sales.execute(user.userId, organizationId, teamId, query.days);
  }
}
