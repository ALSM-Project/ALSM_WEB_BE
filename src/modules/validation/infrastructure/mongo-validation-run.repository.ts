import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateValidationRunInput,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord } from '../domain/validation-run.types';
import { ValidationRun, ValidationRunDocument } from './validation-run.schema';

@Injectable()
export class MongoValidationRunRepository implements ValidationRunRepository {
  constructor(@InjectModel(ValidationRun.name) private readonly model: Model<ValidationRun>) {}

  async create(input: CreateValidationRunInput): Promise<ValidationRunRecord> {
    const document = await this.model.create({
      ...input,
      organizationId: new Types.ObjectId(input.organizationId),
      projectId: new Types.ObjectId(input.projectId),
      conversionJobId: new Types.ObjectId(input.conversionJobId),
    });
    return this.map(document);
  }

  async findById(
    id: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord | null> {
    const document = await this.model.findOne({ _id: id, projectId, organizationId }).exec();
    return document ? this.map(document) : null;
  }

  async listByConversionJob(
    conversionJobId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationRunRecord[]> {
    const documents = await this.model
      .find({ conversionJobId, projectId, organizationId })
      .sort({ createdAt: -1 })
      .exec();
    return documents.map((document) => this.map(document));
  }

  private map(document: ValidationRunDocument): ValidationRunRecord {
    return {
      id: document.id,
      organizationId: document.organizationId.toString(),
      projectId: document.projectId.toString(),
      conversionJobId: document.conversionJobId.toString(),
      screenId: document.screenId,
      status: document.status,
      ruleValidationEnabled: document.ruleValidationEnabled,
      aiValidationEnabled: document.aiValidationEnabled,
      findingCount: document.findingCount,
      startedAt: document.startedAt,
      completedAt: document.completedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
