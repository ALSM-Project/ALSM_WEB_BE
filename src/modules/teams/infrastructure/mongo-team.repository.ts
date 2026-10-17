import { Injectable } from '@nestjs/common';
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
      return this.map(
        await this.model.create({
          ...state,
          organizationId: new Types.ObjectId(input.organizationId),
          revision: 1,
          changes: [change],
        }),
      );
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
