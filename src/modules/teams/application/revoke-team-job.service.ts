import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TeamAccessService, teamId } from './team-access.service';
import { TEAM_UNIT_OF_WORK, TeamUnitOfWork } from './team-unit-of-work.port';

@Injectable()
export class RevokeTeamJobService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_UNIT_OF_WORK) private readonly atomic: TeamUnitOfWork,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    jobSelector: string,
    assignmentSelector: string,
  ) {
    const organization = await this.access.administer(userId, organizationHeader);
    const assignmentId = teamId(assignmentSelector);
    const jobId = teamId(jobSelector),
      selectedTeamId = teamId(id);
    return this.atomic.run(async (repositories) => {
      await repositories.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'TEAM_JOB_REVOCATION_REQUESTED',
        resourceType: 'team',
        resourceId: selectedTeamId,
        metadata: { jobId, assignmentId },
      });
      if (
        !(await repositories.assignments.revoke(
          organization.id,
          selectedTeamId,
          jobId,
          userId,
          assignmentId,
        ))
      )
        throw new NotFoundException({
          code: 'TEAM_JOB_ASSIGNMENT_NOT_FOUND',
          message: 'Active assignment is unavailable in this team and organization',
        });
      await repositories.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'TEAM_JOB_REVOKED',
        resourceType: 'team',
        resourceId: selectedTeamId,
        metadata: { jobId, assignmentId },
      });
      return { revoked: true };
    }, assignmentId);
  }
}
