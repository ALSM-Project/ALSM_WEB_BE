import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toValidObjectId } from '../../../shared/utils/object-id.util';
import { SupportPatchRecord, SupportPatchRepository } from '../domain/support-patch.types';
import { SupportPatch, SupportPatchDocument } from './support-patch.schema';

@Injectable()
export class MongoSupportPatchRepository implements SupportPatchRepository {
  constructor(@InjectModel(SupportPatch.name) private readonly model: Model<SupportPatch>) {}

  async listByJob(jobId: string, organizationId: string): Promise<SupportPatchRecord[]> {
    const docs = await this.model
      .find({ jobId: toValidObjectId(jobId), organizationId: toValidObjectId(organizationId) })
      .sort({ appliedAt: -1 })
      .exec();
    return docs.map((doc) => this.map(doc));
  }

  async create(input: Omit<SupportPatchRecord, 'id'>): Promise<SupportPatchRecord> {
    const doc = await this.model.create({
      ...input,
      organizationId: toValidObjectId(input.organizationId),
      projectId: toValidObjectId(input.projectId),
      jobId: toValidObjectId(input.jobId),
      appliedBy: toValidObjectId(input.appliedBy),
    });
    return this.map(doc);
  }

  private map(doc: SupportPatchDocument): SupportPatchRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      jobId: doc.jobId.toString(),
      screenId: doc.screenId,
      rules: (doc.rules ?? []).map((r) => ({
        sourceField: r.sourceField,
        targetProperty: r.targetProperty,
        dataType: r.dataType,
        ...(r.transformRule ? { transformRule: r.transformRule } : {}),
      })),
      note: doc.note,
      changedRuleCount: doc.changedRuleCount,
      appliedBy: doc.appliedBy.toString(),
      appliedAt: doc.appliedAt,
    };
  }
}
