import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ValidationFindingRecord,
  ValidationRepository,
  ValidationRunRecord,
  FindingStatus,
} from '../domain/validation.types';
import {
  ValidationFinding,
  ValidationFindingDocument,
  ValidationRun,
  ValidationRunDocument,
} from './validation.schema';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoValidationRepository implements ValidationRepository {
  constructor(
    @InjectModel(ValidationRun.name) private readonly runModel: Model<ValidationRun>,
    @InjectModel(ValidationFinding.name) private readonly findingModel: Model<ValidationFinding>,
  ) {}

  async createRun(
    input: Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ValidationRunRecord> {
    const doc = await this.runModel.create({
      ...input,
      conversionJobId: toValidObjectId(input.conversionJobId),
      projectId: toValidObjectId(input.projectId),
    });
    return this.mapRun(doc);
  }

  async findRunByJob(conversionJobId: string): Promise<ValidationRunRecord | null> {
    const doc = await this.runModel
      .findOne({ conversionJobId: toValidObjectId(conversionJobId) })
      .exec();
    return doc ? this.mapRun(doc) : null;
  }

  async createFindings(
    findings: Omit<ValidationFindingRecord, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<ValidationFindingRecord[]> {
    if (!findings.length) return [];
    const docs = await this.findingModel.insertMany(
      findings.map((f) => ({
        ...f,
        conversionJobId: toValidObjectId(f.conversionJobId),
        validationRunId: toValidObjectId(f.validationRunId),
        projectId: toValidObjectId(f.projectId),
      })),
    );
    return docs.map((doc) => this.mapFinding(doc as ValidationFindingDocument));
  }

  async listFindingsByRun(validationRunId: string): Promise<ValidationFindingRecord[]> {
    const docs = await this.findingModel
      .find({ validationRunId: toValidObjectId(validationRunId) })
      .sort({ createdAt: 1 })
      .exec();
    return docs.map((doc) => this.mapFinding(doc));
  }

  async listFindingsByJob(conversionJobId: string): Promise<ValidationFindingRecord[]> {
    const docs = await this.findingModel
      .find({ conversionJobId: toValidObjectId(conversionJobId) })
      .sort({ createdAt: 1 })
      .exec();
    return docs.map((doc) => this.mapFinding(doc));
  }

  async updateFindingStatus(
    id: string,
    status: FindingStatus,
    reviewedBy?: string,
    decision?: string,
  ): Promise<ValidationFindingRecord | null> {
    const doc = await this.findingModel
      .findOneAndUpdate(
        { _id: toValidObjectId(id) },
        {
          $set: {
            status,
            reviewedBy: reviewedBy ?? 'human-reviewer',
            reviewDecision: decision ?? status,
            reviewedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.mapFinding(doc) : null;
  }

  private mapRun(doc: ValidationRunDocument): ValidationRunRecord {
    return {
      id: doc.id,
      conversionJobId: doc.conversionJobId.toString(),
      projectId: doc.projectId.toString(),
      screenId: doc.screenId,
      status: doc.status,
      totalFindings: doc.totalFindings,
      openCount: doc.openCount,
      confirmedCount: doc.confirmedCount,
      rejectedCount: doc.rejectedCount,
      resolvedCount: doc.resolvedCount,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private mapFinding(doc: ValidationFindingDocument): ValidationFindingRecord {
    return {
      id: doc.id,
      conversionJobId: doc.conversionJobId.toString(),
      validationRunId: doc.validationRunId.toString(),
      projectId: doc.projectId.toString(),
      screenId: doc.screenId,
      source: doc.source,
      validatorType: doc.validatorType,
      issueType: doc.issueType,
      severity: doc.severity,
      sourceLocation: doc.sourceLocation,
      targetLocation: doc.targetLocation,
      expectedBehavior: doc.expectedBehavior,
      actualBehavior: doc.actualBehavior,
      explanation: doc.explanation,
      suggestion: doc.suggestion,
      status: doc.status,
      confidence: doc.confidence,
      reviewDecision: doc.reviewDecision,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
