import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  CONVERSION_WORKLOAD,
  ConversionWorkloadPort,
} from '../../conversions/domain/conversion-workload.port';
import { ConversionJobStatus } from '../../conversions/domain/conversion-job.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { TeamKind } from '../domain/team.types';
import {
  TEAM_JOB_ASSIGNMENTS,
  TeamJobAssignmentRecord,
  TeamJobAssignmentRepository,
  WorkloadCounts,
} from '../domain/team-job-assignment.types';
import { reportingPeriod } from '../domain/reporting-period';
import { TeamAccessService } from './team-access.service';

const emptyCounts = (): WorkloadCounts => ({
  assignedJobs: 0,
  processingJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
});
const assignmentFingerprint = (rows: TeamJobAssignmentRecord[]) =>
  rows
    .map((a) => `${a.id}:${a.jobId}:${a.memberId}`)
    .sort()
    .join('|');

@Injectable()
export class GetTeamWorkloadService {
  constructor(
    private readonly access: TeamAccessService,
    @Inject(TEAM_JOB_ASSIGNMENTS) private readonly assignments: TeamJobAssignmentRepository,
    @Inject(CONVERSION_WORKLOAD) private readonly jobs: ConversionWorkloadPort,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}
  async execute(userId: string, organizationHeader: string | undefined, id: string, days: number) {
    const { team, organization } = await this.access.managed(
      userId,
      organizationHeader,
      id,
      TeamKind.CONVERSION,
    );
    if (days !== 7 && days !== 30)
      throw new BadRequestException({
        code: 'INVALID_REPORTING_PERIOD',
        message: 'Choose 7 or 30 days',
      });
    const asOf = new Date(),
      period = reportingPeriod(days, asOf);
    const members: { userId: string; fullName: string; metrics: WorkloadCounts }[] = [];
    for (const memberId of team.memberIds) {
      if (!organization.members.some((m) => m.userId === memberId)) continue;
      const user = await this.users.findById(memberId);
      if (user?.isActive)
        members.push({ userId: memberId, fullName: user.fullName, metrics: emptyCounts() });
    }
    const memberMap = new Map(members.map((m) => [m.userId, m]));
    const assignments = await this.assignments.listActive(organization.id, team.id);
    const totals = emptyCounts(),
      counted = new Set<string>();
    for (const assignment of team.projectAssignments) {
      const project = await this.projects.findById(assignment.projectId, organization.id);
      if (!project || project.deletedAt) continue;
      const scoped = assignments.filter(
        (a) =>
          a.projectId === project.id &&
          memberMap.has(a.memberId) &&
          assignment.memberIds.includes(a.memberId),
      );
      const byJob = new Map(scoped.map((a) => [a.jobId, a]));
      const jobs = await this.jobs.listAssignedJobs({
        organizationId: organization.id,
        projectId: project.id,
        jobIds: [...byJob.keys()],
        start: new Date(period.start),
        end: asOf,
      });
      for (const job of jobs) {
        const owner = byJob.get(job.id);
        if (!owner || counted.has(job.id)) continue;
        counted.add(job.id);
        const metrics = memberMap.get(owner.memberId)!.metrics;
        for (const target of [metrics, totals]) {
          target.assignedJobs++;
          if (job.status === ConversionJobStatus.PROCESSING) target.processingJobs++;
          if (job.status === ConversionJobStatus.COMPLETED) target.completedJobs++;
          if (job.status === ConversionJobStatus.FAILED) target.failedJobs++;
        }
      }
    }
    const current = await this.access.managed(
      userId,
      organization.id,
      team.id,
      TeamKind.CONVERSION,
    );
    const currentAssignments = await this.assignments.listActive(organization.id, team.id);
    if (
      current.team.revision !== team.revision ||
      JSON.stringify(current.organization.members) !== JSON.stringify(organization.members) ||
      assignmentFingerprint(currentAssignments) !== assignmentFingerprint(assignments)
    )
      throw new ConflictException({
        code: 'TEAM_REPORT_CHANGED',
        message: 'Assignments changed while reporting; refresh',
      });
    return {
      team: { id: team.id, name: team.name, kind: team.kind, organizationId: organization.id },
      period,
      asOf: asOf.toISOString(),
      coverage: 'EXPLICIT_ASSIGNMENTS_ONLY',
      jobPeriodField: 'createdAt',
      statusBasis: 'CURRENT',
      totals,
      members,
    };
  }
}
