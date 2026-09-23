import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateValidationFindingInput,
  ReviewValidationFindingInput,
  ReviewValidationFindingResult,
  UpsertValidationFindingInput,
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

  async upsertManyForRun(inputs: UpsertValidationFindingInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const uniqueInputs = [
      ...new Map(
        inputs.map((input) => [
          `${input.organizationId}\0${input.projectId}\0${input.validationRunId}\0${input.fingerprint}`,
          input,
        ]),
      ).values(),
    ];
    await this.model.bulkWrite(
      uniqueInputs.map((input) => ({
        updateOne: {
          filter: {
            organizationId: new Types.ObjectId(input.organizationId),
            projectId: new Types.ObjectId(input.projectId),
            validationRunId: new Types.ObjectId(input.validationRunId),
            fingerprint: input.fingerprint,
          },
          update: { $setOnInsert: this.toPersistence(input) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async countByRun(
    validationRunId: string,
    projectId: string,
    organizationId: string,
  ): Promise<number> {
    return this.model.countDocuments({ validationRunId, projectId, organizationId }).exec();
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

  async reviewFinding(input: ReviewValidationFindingInput): Promise<ReviewValidationFindingResult> {
    const scope = {
      _id: input.findingId,
      validationRunId: input.validationRunId,
      projectId: input.projectId,
      organizationId: input.organizationId,
    };
    const reviewUpdate = {
      status: input.newStatus,
      reviewedBy: new Types.ObjectId(input.reviewedBy),
      reviewedAt: input.reviewedAt,
      ...(input.reviewNote === undefined ? {} : { reviewNote: input.reviewNote }),
    };
    const update =
      input.reviewNote === undefined
        ? { $set: reviewUpdate, $unset: { reviewNote: 1 } }
        : { $set: reviewUpdate };
    const document = await this.model
      .findOneAndUpdate({ ...scope, status: input.expectedStatus }, update, { new: true })
      .exec();

    if (document) return { outcome: 'UPDATED', finding: this.map(document) };

    const existsWithinScope = await this.model.exists(scope).exec();
    return existsWithinScope ? { outcome: 'CONFLICT' } : { outcome: 'NOT_FOUND' };
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
      reviewNote: document.reviewNote,
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
