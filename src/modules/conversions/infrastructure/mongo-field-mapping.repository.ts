import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FieldMapping, FieldMappingDocument } from './field-mapping.schema';
import {
  FieldMappingEntry,
  FieldMappingRecord,
  FieldMappingRepository,
} from '../domain/field-mapping.types';

import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoFieldMappingRepository implements FieldMappingRepository {
  constructor(@InjectModel(FieldMapping.name) private readonly model: Model<FieldMapping>) {}

  async findByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<FieldMappingRecord | null> {
    const orgObjId = toValidObjectId(organizationId);
    const projObjId = toValidObjectId(projectId);

    const doc = await this.model
      .findOne({
        $or: [
          { organizationId: orgObjId, projectId: projObjId, screenId },
          { screenId },
        ],
      })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async upsert(input: {
    organizationId: string;
    projectId: string;
    screenId: string;
    mappings: FieldMappingEntry[];
    updatedBy: string;
  }): Promise<FieldMappingRecord> {
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
            mappings: input.mappings,
            updatedBy: updatedByObjId,
          },
        },
        { new: true, upsert: true },
      )
      .exec();
    return this.map(doc);
  }

  private map(doc: FieldMappingDocument): FieldMappingRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      screenId: doc.screenId,
      mappings: doc.mappings.map((entry) => ({
        legacyField: {
          name: entry.legacyField.name,
          type: entry.legacyField.type,
          length: entry.legacyField.length,
          position: entry.legacyField.position,
        },
        componentMapping: {
          componentType: entry.componentMapping.componentType,
          labelText: entry.componentMapping.labelText,
          isRequired: entry.componentMapping.isRequired,
          minLength: entry.componentMapping.minLength,
          maxLength: entry.componentMapping.maxLength,
          regexPattern: entry.componentMapping.regexPattern,
        },
      })),
      updatedBy: doc.updatedBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
