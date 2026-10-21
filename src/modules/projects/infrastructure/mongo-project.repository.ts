import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Project, ProjectDocument } from './project.schema';
import { ProjectRecord, ProjectRepository } from '../domain/project.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoProjectRepository implements ProjectRepository {
  constructor(@InjectModel(Project.name) private readonly model: Model<Project>) {}

  async create(
    input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<ProjectRecord> {
    const customId = input.id ? toValidObjectId(input.id) : undefined;
    return this.map(
      await this.model.create({
        ...input,
        ...(customId ? { _id: customId } : {}),
        organizationId: toValidObjectId(input.organizationId),
        createdBy: toValidObjectId(input.createdBy),
      }),
    );
  }

  async findById(id: string, organizationId: string): Promise<ProjectRecord | null> {
    if (!organizationId?.trim()) return null;

    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);

    const doc = await this.model
      .findOne({
        $or: [{ _id: projObjId }, { name: id }],
        organizationId: { $in: [orgObjId, organizationId] },
        deletedAt: { $exists: false },
      })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async findAll(organizationId?: string): Promise<ProjectRecord[]> {
    const filter: FilterQuery<ProjectDocument> = { deletedAt: { $exists: false } };
    if (organizationId?.trim()) {
      const orgObjId = toValidObjectId(organizationId);
      filter.organizationId = { $in: [orgObjId, organizationId] };
    }
    return (await this.model.find(filter).sort({ createdAt: -1 }).exec()).map((doc) => this.map(doc));
  }

  async update(
    id: string,
    organizationId: string,
    input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status'>>,
  ): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: projObjId,
          organizationId: { $in: [orgObjId, organizationId] },
          deletedAt: { $exists: false },
        },
        { $set: input },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async assignTeamLead(id: string, teamLeadId: string): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: projObjId, deletedAt: { $exists: false } },
        { $set: { assignedTeamLeadId: toValidObjectId(teamLeadId) } },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async softDelete(id: string, organizationId: string): Promise<boolean> {
    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);
    const result = await this.model
      .updateOne(
        {
          _id: projObjId,
          organizationId: { $in: [orgObjId, organizationId] },
          deletedAt: { $exists: false },
        },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  private map(doc: ProjectDocument): ProjectRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      name: doc.name,
      description: doc.description,
      conversionType: doc.conversionType,
      status: doc.status,
      createdBy: doc.createdBy.toString(),
      isDemo: doc.isDemo,
      assignedTeamLeadId: doc.assignedTeamLeadId?.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      deletedAt: doc.deletedAt,
    };
  }
}
