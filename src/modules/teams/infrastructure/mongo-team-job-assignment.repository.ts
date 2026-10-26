import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, HydratedDocument, Model, Types } from 'mongoose';
import {
  TeamJobAssignmentRecord,
  TeamJobAssignmentRepository,
} from '../domain/team-job-assignment.types';
import { TeamJobAssignment } from './team-job-assignment.schema';

@Injectable()
export class MongoTeamJobAssignmentRepository implements TeamJobAssignmentRepository {
  constructor(
    @InjectModel(TeamJobAssignment.name) private readonly model: Model<TeamJobAssignment>,
  ) {}
  private session?: ClientSession;
  private transaction?: object;
  private assertSession(): void {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale transaction participant');
    }
  }
  inTransaction(session: ClientSession, connection: Connection): MongoTeamJobAssignmentRepository {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Transaction connection mismatch');
    const repository = new MongoTeamJobAssignmentRepository(this.model);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }
  async findById(id: string, organizationId: string, teamId: string) {
    this.assertSession();
    const row = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        teamId: new Types.ObjectId(teamId),
      })
      .session(this.session ?? null)
      .exec();
    return row ? this.map(row) : null;
  }
  async listActive(organizationId: string, teamId: string) {
    this.assertSession();
    const rows = await this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        teamId: new Types.ObjectId(teamId),
        revokedAt: null,
      })
      .session(this.session ?? null)
      .exec();
    return rows.map((row) => this.map(row));
  }
  async assign(input: Parameters<TeamJobAssignmentRepository['assign']>[0]) {
    this.assertSession();
    if (!input.assignmentId) throw new Error('A stable assignment ID is required');
    await this.model.init();
    const indexes = await this.model.collection.indexes();
    const unique = indexes.find((index) => index.name === 'one_active_team_job_assignment');
    if (
      !unique?.unique ||
      JSON.stringify(unique.key) !== JSON.stringify({ organizationId: 1, jobId: 1 }) ||
      JSON.stringify(unique.partialFilterExpression) !== JSON.stringify({ revokedAt: null })
    ) {
      throw new ServiceUnavailableException({
        code: 'TEAM_ASSIGNMENT_INDEX_UNAVAILABLE',
        message:
          'The scoped active-assignment uniqueness index must be provisioned before assignment',
      });
    }
    const existing = await this.model
      .findById(new Types.ObjectId(input.assignmentId))
      .session(this.session ?? null)
      .exec();
    if (existing) {
      if (
        String(existing.organizationId) !== input.organizationId ||
        String(existing.teamId) !== input.teamId ||
        String(existing.projectId) !== input.projectId ||
        String(existing.jobId) !== input.jobId ||
        existing.memberId !== input.memberId ||
        existing.assignedBy !== input.assignedBy
      )
        throw new ConflictException({
          code: 'TEAM_ASSIGNMENT_ID_CONFLICT',
          message: 'Assignment ID already used for a different request',
        });
      return { ...this.map(existing), replayed: true };
    }
    if (
      await this.model
        .exists({
          organizationId: new Types.ObjectId(input.organizationId),
          jobId: new Types.ObjectId(input.jobId),
          revokedAt: null,
        })
        .session(this.session ?? null)
    )
      return null;
    if (this.session) requireActiveTransaction(this.session);
    const [created] = await this.model.create(
      [
        {
          ...input,
          _id: new Types.ObjectId(input.assignmentId),
          organizationId: new Types.ObjectId(input.organizationId),
          teamId: new Types.ObjectId(input.teamId),
          projectId: new Types.ObjectId(input.projectId),
          jobId: new Types.ObjectId(input.jobId),
        },
      ],
      { session: this.session },
    );
    return this.map(created);
  }

  async revoke(
    organizationId: string,
    teamId: string,
    jobId: string,
    actorUserId: string,
    assignmentId: string,
  ) {
    this.assertSession();
    const result = await this.model
      .updateOne(
        {
          _id: new Types.ObjectId(assignmentId),
          organizationId: new Types.ObjectId(organizationId),
          teamId: new Types.ObjectId(teamId),
          jobId: new Types.ObjectId(jobId),
          revokedAt: null,
        },
        { $set: { revokedAt: new Date(), revokedBy: actorUserId } },
      )
      .session(this.session ?? null)
      .exec();
    return result.modifiedCount === 1;
  }
  private map(row: HydratedDocument<TeamJobAssignment>): TeamJobAssignmentRecord {
    return {
      id: String(row._id),
      organizationId: String(row.organizationId),
      teamId: String(row.teamId),
      projectId: String(row.projectId),
      jobId: String(row.jobId),
      memberId: row.memberId,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
      revokedAt: row.revokedAt,
    };
  }
}
