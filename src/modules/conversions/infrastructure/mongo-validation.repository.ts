import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ValidationFindingRecord,
  ValidationRepository,
  ValidationRunRecord,
  FindingStatus,
  LegacyValidationScope,
  ValidatorType,
} from '../domain/validation.types';
import {
  LegacyValidationFinding,
  ValidationFindingDocument,
  LegacyValidationRun,
  ValidationRunDocument,
} from './validation.schema';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoValidationRepository implements ValidationRepository {
  constructor(
    @InjectModel(LegacyValidationRun.name) private readonly runModel: Model<LegacyValidationRun>,
    @InjectModel(LegacyValidationFinding.name)
    private readonly findingModel: Model<LegacyValidationFinding>,
  ) {}

  async createRun(
    input: Omit<ValidationRunRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ValidationRunRecord> {
    const doc = await this.runModel.create({
      ...input,
      conversionJobId: toValidObjectId(input.conversionJobId),
      projectId: toValidObjectId(input.projectId),
      organizationId: toValidObjectId(input.organizationId),
    });
    return this.mapRun(doc);
  }

  async findRunByJob(scope: LegacyValidationScope): Promise<ValidationRunRecord | null> {
    const doc = await this.runModel.findOne(this.runFilter(scope)).exec();
    return doc ? this.mapRun(doc) : null;
  }

  async findRunById(id: string, scope: LegacyValidationScope): Promise<ValidationRunRecord | null> {
    const doc = await this.runModel
      .findOne({ _id: toValidObjectId(id), ...this.runFilter(scope) })
      .exec();
    return doc ? this.mapRun(doc) : null;
  }

  async findFindingById(
    id: string,
    organizationId: string,
  ): Promise<ValidationFindingRecord | null> {
    const doc = await this.findingModel
      .findOne({ _id: toValidObjectId(id), ...this.findingFilter(organizationId) })
      .exec();
    return doc ? this.mapFinding(doc) : null;
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
        ...(f.organizationId ? { organizationId: toValidObjectId(f.organizationId) } : {}),
      })),
    );
    return docs.map((doc) => this.mapFinding(doc as ValidationFindingDocument));
  }

  async listFindingsByRun(
    validationRunId: string,
    scope: LegacyValidationScope,
  ): Promise<ValidationFindingRecord[]> {
    const docs = await this.findingModel
      .find({
        validationRunId: toValidObjectId(validationRunId),
        ...this.scopeFilter(scope),
        ...this.findingFilter(scope.organizationId),
      })
      .sort({ createdAt: 1 })
      .exec();
    return docs.map((doc) => this.mapFinding(doc));
  }

  async updateFindingStatus(
    id: string,
    status: FindingStatus,
    scope: LegacyValidationScope & { validationRunId: string },
    reviewedBy?: string,
    decision?: string,
  ): Promise<ValidationFindingRecord | null> {
    const doc = await this.findingModel
      .findOneAndUpdate(
        {
          _id: toValidObjectId(id),
          validationRunId: toValidObjectId(scope.validationRunId),
          ...this.scopeFilter(scope),
          ...this.findingFilter(scope.organizationId),
        },
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

  private scopeFilter(scope: LegacyValidationScope) {
    return {
      conversionJobId: toValidObjectId(scope.conversionJobId),
      projectId: toValidObjectId(scope.projectId),
      screenId: scope.screenId,
    };
  }

  private runFilter(scope: LegacyValidationScope) {
    return {
      ...this.scopeFilter(scope),
      organizationId: toValidObjectId(scope.organizationId),
      aiValidationEnabled: false,
      ruleValidationEnabled: true,
      provider: { $exists: false },
      model: { $exists: false },
      promptVersion: { $exists: false },
    };
  }

  private findingFilter(organizationId: string) {
    // Collections are shared: model names alone do not isolate persisted records.
    return {
      $or: [
        { organizationId: toValidObjectId(organizationId) },
        { organizationId: { $exists: false } },
      ],
      validatorType: ValidatorType.RULE_VALIDATOR,
      source: { $in: ['Rule Validator', 'Rule Validator Engine'] },
      status: { $in: Object.values(FindingStatus) },
      category: { $exists: false },
      modelProvider: { $exists: false },
      fingerprint: { $exists: false },
    };
  }

  private mapRun(doc: ValidationRunDocument): ValidationRunRecord {
    return {
      id: doc.id,
      conversionJobId: doc.conversionJobId.toString(),
      projectId: doc.projectId.toString(),
      organizationId: doc.organizationId?.toString() || 'org-default',
      screenId: doc.screenId,
      status: doc.status,
      totalFindings: doc.totalFindings,
      findingCount: doc.findingCount,
      aiValidationEnabled: doc.aiValidationEnabled,
      ruleValidationEnabled: doc.ruleValidationEnabled,
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
      organizationId: doc.organizationId?.toString(),
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
