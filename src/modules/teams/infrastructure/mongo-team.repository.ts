import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, HydratedDocument, Model, Types } from 'mongoose';
import { SaveTeamInput, TeamKind, TeamRecord, TeamRepository } from '../domain/team.types';
import { Team } from './team.schema';

@Injectable()
export class MongoTeamRepository implements TeamRepository {
  constructor(@InjectModel(Team.name) private readonly model: Model<Team>) {}

  private session?: ClientSession;
  private transaction?: object;
  private assertSession(): void {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale transaction participant');
    }
  }
  inTransaction(session: ClientSession, connection: Connection): MongoTeamRepository {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Transaction connection mismatch');
    const repository = new MongoTeamRepository(this.model);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }
  async findById(id: string, organizationId: string): Promise<TeamRecord | null> {
    this.assertSession();
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), organizationId: new Types.ObjectId(organizationId) })
      .session(this.session ?? null)
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findManaged(
    id: string,
    organizationId: string,
    managerId: string,
    kind: TeamKind,
  ): Promise<TeamRecord | null> {
    this.assertSession();
    const doc = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        managerIds: managerId,
        kind,
      })
      .session(this.session ?? null)
      .exec();
    return doc ? this.map(doc) : null;
  }

  async listManaged(
    organizationId: string,
    managerId: string,
    kind: TeamKind,
  ): Promise<TeamRecord[]> {
    this.assertSession();
    const docs = await this.model
      .find({ organizationId: new Types.ObjectId(organizationId), managerIds: managerId, kind })
      .sort({ name: 1, _id: 1 })
      .session(this.session ?? null)
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async save(input: SaveTeamInput): Promise<TeamRecord | null> {
    this.assertSession();
    const state = {
      name: input.name,
      kind: input.kind,
      memberIds: input.memberIds,
      managerIds: input.managerIds,
      projectAssignments: input.projectAssignments,
    };
    const change = {
      ...state,
      actorUserId: input.actorUserId,
      at: new Date(),
      revision: input.expectedRevision + 1,
    };
    if (!input.id) {
      if (!input.creationId) throw new Error('A stable creation ID is required');
      const creationId = new Types.ObjectId(input.creationId);
      const existing = await this.model
        .findById(creationId)
        .session(this.session ?? null)
        .exec();
      if (existing) {
        const first = existing.changes[0];
        const original =
          first && Object.fromEntries(Object.keys(state).map((key) => [key, first[key]]));
        if (
          String(existing.organizationId) !== input.organizationId ||
          first?.actorUserId !== input.actorUserId ||
          JSON.stringify(original) !== JSON.stringify(state)
        )
          throw new ConflictException({
            code: 'TEAM_CREATION_ID_CONFLICT',
            message: 'Creation ID already used for a different request',
          });
        return { ...this.map(existing), replayedCreation: true };
      }
      if (this.session) requireActiveTransaction(this.session);
      const [created] = await this.model.create(
        [
          {
            ...state,
            _id: creationId,
            organizationId: new Types.ObjectId(input.organizationId),
            revision: 1,
            changes: [change],
          },
        ],
        { session: this.session },
      );
      return this.map(created);
    }

    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(input.id),
          organizationId: new Types.ObjectId(input.organizationId),
          kind: input.kind,
          revision: input.expectedRevision,
        },
        { $set: state, $inc: { revision: 1 }, $push: { changes: change } },
        { new: true, runValidators: true },
      )
      .session(this.session ?? null)
      .exec();
    return doc ? this.map(doc) : null;
  }

  private map(doc: HydratedDocument<Team>): TeamRecord {
    return {
      id: String(doc._id),
      organizationId: String(doc.organizationId),
      name: doc.name,
      kind: doc.kind,
      memberIds: [...doc.memberIds],
      managerIds: [...doc.managerIds],
      projectAssignments: doc.projectAssignments.map((p) => ({
        projectId: p.projectId,
        memberIds: [...p.memberIds],
      })),
      revision: doc.revision,
    };
  }
}
