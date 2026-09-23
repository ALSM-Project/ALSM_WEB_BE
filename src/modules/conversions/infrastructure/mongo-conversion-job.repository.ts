import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversionJob, ConversionJobDocument } from './conversion-job.schema';
import {
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoConversionJobRepository implements ConversionJobRepository {
  constructor(@InjectModel(ConversionJob.name) private readonly model: Model<ConversionJob>) {}

  async create(
    input: Omit<ConversionJobRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ConversionJobRecord> {
    return this.map(
      await this.model.create({
        ...input,
        organizationId: toValidObjectId(input.organizationId),
        projectId: toValidObjectId(input.projectId),
        createdBy: toValidObjectId(input.createdBy),
      }),
    );
  }

  async findById(id: string, organizationId: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model.findOne({ _id: jobObjId }).exec();
    return doc ? this.map(doc) : null;
  }

  async findByIdAnyOrganization(id: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model.findById(jobObjId).exec();
    return doc ? this.map(doc) : null;
  }

  async listByProject(projectId: string, organizationId: string): Promise<ConversionJobRecord[]> {
    const projObjId = toValidObjectId(projectId);
    const docs = await this.model.find({ projectId: projObjId }).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.map(doc));
  }

  async listByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<ConversionJobRecord[]> {
    const projObjId = toValidObjectId(projectId);
    const docs = await this.model
      .find({
        projectId: projObjId,
        screenId,
      })
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async retry(id: string, organizationId: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: jobObjId,
          status: { $in: [ConversionJobStatus.FAILED, ConversionJobStatus.DEAD] },
        },
        {
          $set: {
            status: ConversionJobStatus.QUEUED,
            errorCode: undefined,
            errorMessage: undefined,
            completedAt: undefined,
            startedAt: undefined,
          },
          $inc: { attemptCount: 1 },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async markProcessing(id: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: jobObjId,
          status: { $in: [ConversionJobStatus.QUEUED, ConversionJobStatus.PROCESSING] },
        },
        { $set: { status: ConversionJobStatus.PROCESSING, startedAt: new Date() } },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async markCompleted(
    id: string,
    resultReference: string,
    toolVersion?: string,
  ): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: jobObjId },
        {
          $set: {
            status: ConversionJobStatus.COMPLETED,
            resultReference,
            toolVersion: toolVersion ?? 'v1.0.0-alsm-conversion-engine',
            completedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    const jobObjId = toValidObjectId(id);
    await this.model
      .updateOne(
        { _id: jobObjId },
        {
          $set: {
            status: ConversionJobStatus.FAILED,
            errorCode: code,
            errorMessage: message,
            completedAt: new Date(),
          },
        },
      )
      .exec();
  }

  private map(doc: ConversionJobDocument): ConversionJobRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      screenId: doc.screenId,
      conversionType: doc.conversionType,
      status: doc.status,
      priority: doc.priority,
      attemptCount: doc.attemptCount,
      maxAttempts: doc.maxAttempts,
      inputReference: doc.inputReference,
      resultReference: doc.resultReference,
      errorCode: doc.errorCode,
      errorMessage: doc.errorMessage,
      toolVersion: doc.toolVersion,
      createdBy: doc.createdBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
    };
  }
}
