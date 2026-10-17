import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TEAM_JOB_ASSIGNMENTS,
  TeamJobAssignmentRepository,
} from '../domain/team-job-assignment.types';
import { TeamAccessService, teamId } from './team-access.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { businessMutation, completedAudit, requestedAudit } from './team-mutation-outcome';

@Injectable()
export class RevokeTeamJobService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_JOB_ASSIGNMENTS) private readonly assignments: TeamJobAssignmentRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
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
    await requestedAudit(() =>
      this.audit.append({
        actorUserId: userId,
        organizationId: organization.id,
        action: 'TEAM_JOB_REVOCATION_REQUESTED',
        resourceType: 'team',
        resourceId: selectedTeamId,
        metadata: { jobId, assignmentId },
      }),
    );
    if (
      !(await businessMutation(
        () => this.assignments.revoke(organization.id, selectedTeamId, jobId, userId, assignmentId),
        assignmentId,
      ))
    )
      throw new NotFoundException({
        code: 'TEAM_JOB_ASSIGNMENT_NOT_FOUND',
        message: 'Active assignment is unavailable in this team and organization',
      });
    await completedAudit(
      () =>
        this.audit.append({
          actorUserId: userId,
          organizationId: organization.id,
          action: 'TEAM_JOB_REVOKED',
          resourceType: 'team',
          resourceId: selectedTeamId,
          metadata: { jobId, assignmentId },
        }),
      assignmentId,
    );
    return { revoked: true };
  }
}
