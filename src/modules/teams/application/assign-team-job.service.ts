import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../domain/team.types';
import {
  TEAM_JOB_ASSIGNMENTS,
  TeamJobAssignmentRepository,
} from '../domain/team-job-assignment.types';
import { TeamAccessService, teamId } from './team-access.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
} from '../../conversions/domain/conversion-job.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';

@Injectable()
export class AssignTeamJobService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(TEAM_JOB_ASSIGNMENTS) private readonly assignments: TeamJobAssignmentRepository,
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    jobSelector: string,
    memberSelector: string,
  ) {
    const organization = await this.access.administer(userId, organizationHeader);
    const team = await this.teams.findById(teamId(id), organization.id);
    if (!team || team.kind !== TeamKind.CONVERSION)
      throw new NotFoundException({
        code: 'TEAM_NOT_FOUND',
        message: 'Conversion Team is unavailable',
      });
    const jobId = teamId(jobSelector),
      memberId = teamId(memberSelector);
    const job = await this.jobs.findById(jobId, organization.id);
    const project = job ? await this.projects.findById(job.projectId, organization.id) : null;
    if (
      !job ||
      job.organizationId !== organization.id ||
      !project ||
      project.id !== job.projectId ||
      project.organizationId !== organization.id ||
      project.deletedAt ||
      !team.memberIds.includes(memberId) ||
      !organization.members.some((m) => m.userId === memberId) ||
      !team.projectAssignments.some(
        (p) => p.projectId === job.projectId && p.memberIds.includes(memberId),
      ) ||
      !(await this.users.findById(memberId))?.isActive
    ) {
      throw new BadRequestException({
        code: 'INVALID_TEAM_JOB_ASSIGNMENT',
        message:
          'A current team member, explicit project assignment and existing job in this organization are required',
      });
    }
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'TEAM_JOB_ASSIGNMENT_REQUESTED',
      resourceType: 'team',
      resourceId: team.id,
      metadata: { jobId, memberId },
    });
    const result = await this.assignments.assign({
      organizationId: organization.id,
      teamId: team.id,
      projectId: job.projectId,
      jobId,
      memberId,
      assignedBy: userId,
    });
    if (!result)
      throw new ConflictException({
        code: 'TEAM_JOB_ALREADY_ASSIGNED',
        message:
          'This job already has an active assignment; revoke it explicitly before reassignment',
      });
    await this.audit.append({
      actorUserId: userId,
      organizationId: organization.id,
      action: 'TEAM_JOB_ASSIGNED',
      resourceType: 'team_job_assignment',
      resourceId: result.id,
      metadata: { teamId: team.id, jobId, memberId },
    });
    return result;
  }
}
