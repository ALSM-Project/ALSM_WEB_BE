import { AuditRepository } from '../../audit/domain/audit.repository';
import { TeamRepository } from '../domain/team.types';
import { TeamJobAssignmentRepository } from '../domain/team-job-assignment.types';

export interface TeamMutationRepositories {
  teams: TeamRepository;
  assignments: TeamJobAssignmentRepository;
  audit: AuditRepository;
}
export interface TeamUnitOfWork {
  run<T>(
    work: (repositories: TeamMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T>;
}
export const TEAM_UNIT_OF_WORK = Symbol('TEAM_UNIT_OF_WORK');
