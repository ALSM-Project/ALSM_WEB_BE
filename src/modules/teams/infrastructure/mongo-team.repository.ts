import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, Types } from 'mongoose';
import { SaveTeamInput, TeamKind, TeamRecord, TeamRepository } from '../domain/team.types';
import { Team } from './team.schema';

@Injectable()
export class MongoTeamRepository implements TeamRepository {
  constructor(@InjectModel(Team.name) private readonly model: Model<Team>) {}

  async findById(id: string, organizationId: string): Promise<TeamRecord | null> {
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), organizationId: new Types.ObjectId(organizationId) })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findManaged(
    id: string,
    organizationId: string,
    managerId: string,
    kind: TeamKind,
  ): Promise<TeamRecord | null> {
    const doc = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        managerIds: managerId,
        kind,
      })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async listManaged(
    organizationId: string,
    managerId: string,
    kind: TeamKind,
  ): Promise<TeamRecord[]> {
    const docs = await this.model
      .find({ organizationId: new Types.ObjectId(organizationId), managerIds: managerId, kind })
      .sort({ name: 1, _id: 1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async save(input: SaveTeamInput): Promise<TeamRecord | null> {
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
      try {
        return this.map(
          await this.model.create({
            ...state,
            _id: creationId,
            organizationId: new Types.ObjectId(input.organizationId),
            revision: 1,
            changes: [change],
          }),
        );
      } catch (error) {
        if (!(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000
        ))
          throw error;
        // The permanent _id fence survives subsequent edits. Compare the original
        // actor and payload, never overwrite current state when replaying creation.
        const existing = await this.model
          .findOne({ _id: creationId, organizationId: new Types.ObjectId(input.organizationId) })
          .exec();
        const first = existing?.changes[0];
        const original =
          first && Object.fromEntries(Object.keys(state).map((key) => [key, first[key]]));
        if (
          !existing ||
          first?.actorUserId !== input.actorUserId ||
          JSON.stringify(original) !== JSON.stringify(state)
        )
          throw new ConflictException({
            code: 'TEAM_CREATION_ID_CONFLICT',
            message:
              'Creation ID already used; reconcile the original request, never reuse it for different input',
          });
        return { ...this.map(existing), replayedCreation: true };
      }
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
