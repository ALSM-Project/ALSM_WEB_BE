import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { AssignTeamJobService } from '../application/assign-team-job.service';
import { RevokeTeamJobService } from '../application/revoke-team-job.service';
import { ListTeamJobAssignmentsService } from '../application/list-team-job-assignments.service';
import { AssignTeamJobDto, RevokeTeamJobQuery } from './team.dto';

@ApiTags('Team assignments')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('teams/:teamId/job-assignments')
export class TeamJobAssignmentsController {
  constructor(
    private readonly assign: AssignTeamJobService,
    private readonly revoke: RevokeTeamJobService,
    private readonly list: ListTeamJobAssignmentsService,
  ) {}
  @Post()
  @ApiOperation({
    summary:
      'Explicitly assign a persisted job to a team/project member; requires organization OWNER/ADMIN and users.manage',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
    @Body() input: AssignTeamJobDto,
  ) {
    return this.assign.execute(
      user.userId,
      organizationId,
      teamId,
      input.jobId,
      input.memberId,
      input.assignmentId,
    );
  }
  @Delete(':jobId')
  @ApiOperation({
    summary:
      'Revoke an explicit job assignment, retaining attribution; requires organization OWNER/ADMIN and users.manage',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
    @Param('jobId') jobId: string,
    @Query() query: RevokeTeamJobQuery,
  ) {
    return this.revoke.execute(user.userId, organizationId, teamId, jobId, query.assignmentId);
  }
  @Get()
  @ApiOperation({
    summary: 'Inspect active assignments; requires organization OWNER/ADMIN and users.manage',
  })
  listAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
  ) {
    return this.list.execute(user.userId, organizationId, teamId);
  }
  @Get(':assignmentId')
  @ApiOperation({
    summary:
      'Reconcile a retained assignment, including revocation, with administrator authorization',
  })
  getAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') teamId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.list.execute(user.userId, organizationId, teamId, assignmentId);
  }
}
