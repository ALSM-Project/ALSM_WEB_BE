import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConversionQualityReviewRecord,
  ConversionQualityReviewRepository,
  UpsertQualityReviewInput,
  UpsertQualityReviewOutcome,
} from '../domain/conversion-quality-review.types';
import {
  ConversionQualityReview,
  ConversionQualityReviewDocument,
} from './conversion-quality-review.schema';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoConversionQualityReviewRepository implements ConversionQualityReviewRepository {
  constructor(
    @InjectModel(ConversionQualityReview.name)
    private readonly model: Model<ConversionQualityReview>,
  ) {}

  async findByConversionJob(
    conversionJobId: string,
    projectId: string,
    organizationId: string,
  ): Promise<ConversionQualityReviewRecord | null> {
    const doc = await this.model
      .findOne({
        conversionJobId: toValidObjectId(conversionJobId),
        projectId: toValidObjectId(projectId),
        organizationId: toValidObjectId(organizationId),
      })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async upsert(input: UpsertQualityReviewInput): Promise<{
    outcome: UpsertQualityReviewOutcome;
    record: ConversionQualityReviewRecord;
  }> {
    const conversionJobIdObj = toValidObjectId(input.conversionJobId);
    const projectIdObj = toValidObjectId(input.projectId);
    const organizationIdObj = toValidObjectId(input.organizationId);
    const reviewedByObj = toValidObjectId(input.reviewedBy);

    // Base filter — always scoped by tenant + job
    const filter: Record<string, unknown> = {
      conversionJobId: conversionJobIdObj,
      projectId: projectIdObj,
      organizationId: organizationIdObj,
    };

    // Compare-and-set: if expectedStatus is provided, enforce it
    if (input.expectedStatus !== undefined) {
      filter['status'] = input.expectedStatus;
    }

    const setFields: Record<string, unknown> = {
      status: input.status,
      reviewedBy: reviewedByObj,
      reviewedAt: input.reviewedAt,
    };
    if (input.reviewNote !== undefined) setFields['reviewNote'] = input.reviewNote;
    if (input.qualityScore !== undefined) setFields['qualityScore'] = input.qualityScore;
    if (input.screenId !== undefined) setFields['screenId'] = input.screenId;

    const setOnInsert: Record<string, unknown> = {
      organizationId: organizationIdObj,
      projectId: projectIdObj,
      conversionJobId: conversionJobIdObj,
    };

    // Attempt the conditional findOneAndUpdate first (handles both insert and update)
    const updatedDoc = await this.model
      .findOneAndUpdate(
        filter,
        { $set: setFields, $setOnInsert: setOnInsert },
        { new: true, upsert: true },
      )
      .exec()
      .catch((err: unknown) => {
        // Duplicate key error from upsert means a document exists but doesn't match the filter
        // (compare-and-set conflict — another reviewer changed the status first)
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: number }).code === 11000
        ) {
          return null;
        }
        throw err;
      });

    if (!updatedDoc) {
      // Conflict: document exists but status didn't match expectedStatus
      const existing = await this.findByConversionJob(
        input.conversionJobId,
        input.projectId,
        input.organizationId,
      );
      // existing is guaranteed to exist since we got a dup-key conflict
      return { outcome: 'CONFLICT', record: existing! };
    }

    // Determine if this was a create or update by checking timestamps
    const isNew = Math.abs(updatedDoc.createdAt.getTime() - updatedDoc.updatedAt.getTime()) < 100;

    return {
      outcome: isNew ? 'CREATED' : 'UPDATED',
      record: this.map(updatedDoc),
    };
  }

  private map(doc: ConversionQualityReviewDocument): ConversionQualityReviewRecord {
    return {
      id: doc.id as string,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      conversionJobId: doc.conversionJobId.toString(),
      screenId: doc.screenId,
      status: doc.status,
      reviewNote: doc.reviewNote,
      qualityScore: doc.qualityScore,
      reviewedBy: doc.reviewedBy?.toString(),
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
