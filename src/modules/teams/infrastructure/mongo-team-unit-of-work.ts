import { ClientSession, Connection } from 'mongoose';
import { AuditRepository } from '../../audit/domain/audit.repository';
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { TeamMutationRepositories, TeamUnitOfWork } from '../application/team-unit-of-work.port';
import { MongoTeamRepository } from './mongo-team.repository';
import { MongoTeamJobAssignmentRepository } from './mongo-team-job-assignment.repository';

export class MongoTeamUnitOfWork implements TeamUnitOfWork {
  constructor(
    private readonly connection: Connection,
    private readonly teams: MongoTeamRepository,
    private readonly assignments: MongoTeamJobAssignmentRepository,
    private readonly audit: (session: ClientSession, connection: Connection) => AuditRepository,
  ) {}
  run<T>(
    work: (repositories: TeamMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T> {
    return new MongoTransactionRunner(this.connection).run(
      (session) =>
        work({
          teams: this.teams.inTransaction(session, this.connection),
          assignments: this.assignments.inTransaction(session, this.connection),
          audit: this.audit(session, this.connection),
        }),
      resourceId,
    );
  }
}
