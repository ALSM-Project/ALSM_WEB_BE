import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import {
  CompleteValidationRunInput,
  CreateOrGetActiveValidationRunResult,
  CreateValidationRunInput,
  FailValidationRunInput,
  ValidationRunRepository,
} from '../domain/validation-run.repository';
import { ValidationRunRecord, ValidationRunStatus } from '../domain/validation-run.types';
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

  async createOrGetActiveAiRun(
    input: CreateValidationRunInput,
  ): Promise<CreateOrGetActiveValidationRunResult> {
    const activeExecutionKey = this.activeExecutionKey(input);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const document = await this.model.create({
          ...input,
          organizationId: new Types.ObjectId(input.organizationId),
          projectId: new Types.ObjectId(input.projectId),
          conversionJobId: new Types.ObjectId(input.conversionJobId),
          activeExecutionKey,
        });
        return { run: this.map(document), created: true };
      } catch (error) {
        if (!this.isDuplicateKey(error)) throw error;
        const existing = await this.model
          .findOne({
            activeExecutionKey,
            organizationId: input.organizationId,
            projectId: input.projectId,
            conversionJobId: input.conversionJobId,
            status: {
              $in: [ValidationRunStatus.QUEUED, ValidationRunStatus.PROCESSING],
            },
          })
          .exec();
        if (existing) return { run: this.map(existing), created: false };
      }
    }

    throw new Error('Unable to claim an active AI validation run');
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

  async markCompleted(
    id: string,
    projectId: string,
    organizationId: string,
    input: CompleteValidationRunInput,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, projectId, organizationId },
        {
          $set: {
            status: ValidationRunStatus.COMPLETED,
            findingCount: input.findingCount,
            redactionCount: input.redactionCount,
            selectedFileCount: input.selectedFileCount,
            inputCharacterCount: input.inputCharacterCount,
            failureCode: undefined,
            failureMessage: undefined,
            completedAt: new Date(),
          },
          $unset: { activeExecutionKey: 1 },
        },
      )
      .exec();
  }

  async markFailed(
    id: string,
    projectId: string,
    organizationId: string,
    input: FailValidationRunInput,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, projectId, organizationId },
        {
          $set: {
            status: ValidationRunStatus.FAILED,
            findingCount: 0,
            failureCode: input.failureCode,
            failureMessage: input.failureMessage,
            redactionCount: input.redactionCount,
            selectedFileCount: input.selectedFileCount,
            inputCharacterCount: input.inputCharacterCount,
            completedAt: new Date(),
          },
          $unset: { activeExecutionKey: 1 },
        },
      )
      .exec();
  }

  private activeExecutionKey(input: CreateValidationRunInput): string {
    return createHash('sha256')
      .update(`${input.organizationId}\0${input.projectId}\0${input.conversionJobId}\0AI`)
      .digest('hex');
  }

  private isDuplicateKey(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 11_000;
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
      provider: document.provider,
      model: document.model,
      promptVersion: document.promptVersion,
      redactionCount: document.redactionCount,
      selectedFileCount: document.selectedFileCount,
      inputCharacterCount: document.inputCharacterCount,
      failureCode: document.failureCode,
      failureMessage: document.failureMessage,
      startedAt: document.startedAt,
      completedAt: document.completedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
