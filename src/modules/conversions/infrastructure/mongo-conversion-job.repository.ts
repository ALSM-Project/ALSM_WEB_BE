import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
    const orgObjId = toValidObjectId(organizationId);
    const doc = await this.model.findOne({ _id: jobObjId, organizationId: orgObjId }).exec();
    return doc ? this.map(doc) : null;
  }

  async findByIdAnyOrganization(id: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model.findById(jobObjId).exec();
    return doc ? this.map(doc) : null;
  }

  async listByProject(projectId: string, organizationId: string): Promise<ConversionJobRecord[]> {
    const projObjId = toValidObjectId(projectId);
    const orgObjId = toValidObjectId(organizationId);
    const docs = await this.model
      .find({ projectId: projObjId, organizationId: orgObjId })
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async listByScreen(
    projectId: string,
    screenId: string,
    organizationId: string,
  ): Promise<ConversionJobRecord[]> {
    const projObjId = toValidObjectId(projectId);
    const orgObjId = toValidObjectId(organizationId);

    const clean = screenId ? screenId.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '') : '';
    const escapedName = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = clean
      ? new RegExp(`^${escapedName}(\\.(bms|dspf|cob|cbl|cpy))?$`, 'i')
      : null;

    const screenConditions: Record<string, unknown>[] = [{ screenId }];
    if (clean) screenConditions.push({ screenId: clean });
    if (nameRegex) screenConditions.push({ screenId: nameRegex });
    screenConditions.push({ inputReference: screenId });
    if (clean) screenConditions.push({ inputReference: clean });

    const docs = await this.model
      .find({
        organizationId: orgObjId,
        projectId: projObjId,
        $or: screenConditions,
      })
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async retry(id: string, organizationId: string): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: jobObjId,
          organizationId: orgObjId,
          status: { $in: [ConversionJobStatus.FAILED, ConversionJobStatus.DEAD] },
        },
        {
          $set: {
            status: ConversionJobStatus.QUEUED,
            attemptCount: 0,
          },
          $unset: {
            errorCode: 1,
            errorMessage: 1,
            completedAt: 1,
            startedAt: 1,
            processingToken: 1,
            processingLeaseExpiresAt: 1,
          },
          $inc: { executionGeneration: 1 },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async markProcessing(
    id: string,
    token: string,
    leaseExpiresAt: Date,
    executionGeneration: number,
  ): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: jobObjId,
          $and: [
            executionGeneration === 0
              ? { $or: [{ executionGeneration: 0 }, { executionGeneration: { $exists: false } }] }
              : { executionGeneration },
            {
              $or: [
                { status: ConversionJobStatus.QUEUED },
                {
                  status: ConversionJobStatus.PROCESSING,
                  processingLeaseExpiresAt: { $lte: new Date() },
                },
              ],
            },
          ],
        },
        {
          $set: {
            status: ConversionJobStatus.PROCESSING,
            startedAt: new Date(),
            processingToken: token,
            processingLeaseExpiresAt: leaseExpiresAt,
          },
          $inc: { attemptCount: 1 },
          $unset: { errorCode: 1, errorMessage: 1, completedAt: 1 },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async renewProcessingLease(id: string, token: string, leaseExpiresAt: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(this.processingFilter(id, token), {
        $set: { processingLeaseExpiresAt: leaseExpiresAt },
      })
      .exec();
    return result.modifiedCount === 1;
  }

  async releaseProcessingForRetry(id: string, token: string): Promise<boolean> {
    const result = await this.model
      .updateOne(this.processingFilter(id, token), {
        $set: { status: ConversionJobStatus.QUEUED },
        $unset: { processingToken: 1, processingLeaseExpiresAt: 1 },
      })
      .exec();
    return result.modifiedCount === 1;
  }

  private processingFilter(id: string, token: string): Record<string, unknown> {
    return {
      _id: toValidObjectId(id),
      status: ConversionJobStatus.PROCESSING,
      processingToken: token,
      processingLeaseExpiresAt: { $gt: new Date() },
    };
  }

  async markAbandonedFailed(id: string, executionGeneration: number): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: toValidObjectId(id),
          status: ConversionJobStatus.PROCESSING,
          processingLeaseExpiresAt: { $lte: new Date() },
          ...(executionGeneration === 0
            ? { $or: [{ executionGeneration: 0 }, { executionGeneration: { $exists: false } }] }
            : { executionGeneration }),
        },
        {
          $set: {
            status: ConversionJobStatus.FAILED,
            errorCode: 'CONVERSION_WORKER_STALLED',
            errorMessage: 'Conversion worker stopped before completion; retry is required',
            completedAt: new Date(),
          },
          $unset: { processingToken: 1, processingLeaseExpiresAt: 1 },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async markCompleted(
    id: string,
    resultReferenceOrOutput: string | { resultReference: string; toolVersion?: string },
    toolVersion?: string,
    processingToken?: string,
  ): Promise<ConversionJobRecord | null> {
    const jobObjId = toValidObjectId(id);
    const resultRef =
      typeof resultReferenceOrOutput === 'string'
        ? resultReferenceOrOutput
        : resultReferenceOrOutput.resultReference;
    const version =
      typeof resultReferenceOrOutput === 'string'
        ? toolVersion
        : resultReferenceOrOutput.toolVersion;

    const doc = await this.model
      .findOneAndUpdate(
        processingToken
          ? this.processingFilter(id, processingToken)
          : { _id: jobObjId, status: ConversionJobStatus.PROCESSING },
        {
          $set: {
            status: ConversionJobStatus.COMPLETED,
            resultReference: resultRef,
            ...(version !== undefined ? { toolVersion: version } : {}),
            completedAt: new Date(),
          },
          $unset: { processingToken: 1, processingLeaseExpiresAt: 1 },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async markFailed(
    id: string,
    code: string,
    message: string,
    processingToken?: string,
  ): Promise<void> {
    const jobObjId = toValidObjectId(id);
    await this.model
      .updateOne(
        processingToken
          ? this.processingFilter(id, processingToken)
          : { _id: jobObjId, status: ConversionJobStatus.QUEUED },
        {
          $set: {
            status: ConversionJobStatus.FAILED,
            errorCode: code,
            errorMessage: message,
            completedAt: new Date(),
          },
          $unset: { processingToken: 1, processingLeaseExpiresAt: 1 },
        },
      )
      .exec();
  }

  async updateResultReference(id: string, resultReference: string): Promise<void> {
    const jobObjId = toValidObjectId(id);
    await this.model.updateOne({ _id: jobObjId }, { $set: { resultReference } }).exec();
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
      executionGeneration: doc.executionGeneration ?? 0,
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
