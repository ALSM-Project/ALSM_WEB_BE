import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateValidationFindingInput,
  ValidationFindingRepository,
} from '../domain/validation-finding.repository';
import { CodeLocation, ValidationFindingRecord } from '../domain/validation-finding.types';
import { ValidationFinding, ValidationFindingDocument } from './validation-finding.schema';

type ValidationFindingPersistenceInput = Omit<
  CreateValidationFindingInput,
  'organizationId' | 'projectId' | 'conversionJobId' | 'validationRunId' | 'reviewedBy'
> & {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  conversionJobId: Types.ObjectId;
  validationRunId: Types.ObjectId;
  reviewedBy?: Types.ObjectId;
};

@Injectable()
export class MongoValidationFindingRepository implements ValidationFindingRepository {
  constructor(
    @InjectModel(ValidationFinding.name) private readonly model: Model<ValidationFinding>,
  ) {}

  async create(input: CreateValidationFindingInput): Promise<ValidationFindingRecord> {
    return this.map(await this.model.create(this.toPersistence(input)));
  }

  async createMany(inputs: CreateValidationFindingInput[]): Promise<ValidationFindingRecord[]> {
    if (inputs.length === 0) return [];
    const documents = await this.model.insertMany(inputs.map((input) => this.toPersistence(input)));
    return documents.map((document) => this.map(document));
  }

  async findById(
    id: string,
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord | null> {
    const document = await this.model
      .findOne({ _id: id, validationRunId, projectId, organizationId })
      .exec();
    return document ? this.map(document) : null;
  }

  async listByRun(
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord[]> {
    const documents = await this.model
      .find({ validationRunId, projectId, organizationId })
      .sort({ createdAt: 1 })
      .exec();
    return documents.map((document) => this.map(document));
  }

  private toPersistence(input: CreateValidationFindingInput): ValidationFindingPersistenceInput {
    return {
      ...input,
      organizationId: new Types.ObjectId(input.organizationId),
      projectId: new Types.ObjectId(input.projectId),
      conversionJobId: new Types.ObjectId(input.conversionJobId),
      validationRunId: new Types.ObjectId(input.validationRunId),
      reviewedBy: input.reviewedBy ? new Types.ObjectId(input.reviewedBy) : undefined,
    };
  }

  private map(document: ValidationFindingDocument): ValidationFindingRecord {
    return {
      id: document.id,
      organizationId: document.organizationId.toString(),
      projectId: document.projectId.toString(),
      conversionJobId: document.conversionJobId.toString(),
      validationRunId: document.validationRunId.toString(),
      screenId: document.screenId,
      source: document.source,
      category: document.category,
      severity: document.severity,
      status: document.status,
      title: document.title,
      explanation: document.explanation,
      expectedBehavior: document.expectedBehavior,
      actualBehavior: document.actualBehavior,
      suggestion: document.suggestion,
      sourceLocation: this.mapLocation(document.sourceLocation),
      targetLocation: this.mapLocation(document.targetLocation),
      confidence: document.confidence,
      modelProvider: document.modelProvider,
      modelName: document.modelName,
      reviewedBy: document.reviewedBy?.toString(),
      reviewedAt: document.reviewedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }

  private mapLocation(location: CodeLocation | undefined): CodeLocation | undefined {
    if (!location) return undefined;
    return {
      file: location.file,
      startLine: location.startLine,
      endLine: location.endLine,
      snippet: location.snippet,
    };
  }
}
