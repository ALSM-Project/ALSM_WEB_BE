import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MethodMapping, MethodMappingDocument } from './method-mapping.schema';
import {
  MethodMappingEntry,
  MethodMappingRecord,
  MethodMappingRepository,
} from '../domain/method-mapping.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoMethodMappingRepository implements MethodMappingRepository {
  constructor(@InjectModel(MethodMapping.name) private readonly model: Model<MethodMapping>) {}

  async findByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<MethodMappingRecord | null> {
    const orgObjId = toValidObjectId(organizationId);
    const projObjId = toValidObjectId(projectId);

    const doc = await this.model
      .findOne({ organizationId: orgObjId, projectId: projObjId, screenId })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async upsert(input: {
    organizationId: string;
    projectId: string;
    screenId: string;
    entries: MethodMappingEntry[];
    updatedBy: string;
  }): Promise<MethodMappingRecord> {
    const orgObjId = toValidObjectId(input.organizationId);
    const projObjId = toValidObjectId(input.projectId);
    const updatedByObjId = toValidObjectId(input.updatedBy);

    const doc = await this.model
      .findOneAndUpdate(
        {
          organizationId: orgObjId,
          projectId: projObjId,
          screenId: input.screenId,
        },
        {
          $set: {
            entries: input.entries,
            updatedBy: updatedByObjId,
          },
        },
        { new: true, upsert: true },
      )
      .exec();
    return this.map(doc);
  }

  private map(doc: MethodMappingDocument): MethodMappingRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      screenId: doc.screenId,
      entries: doc.entries.map((entry) => ({
        relativePath: entry.relativePath,
        kind: entry.kind,
        originalName: entry.originalName,
        targetName: entry.targetName,
      })),
      updatedBy: doc.updatedBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
