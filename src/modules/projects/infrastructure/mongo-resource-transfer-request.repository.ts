import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  ResourceTransferRequest,
  ResourceTransferRequestDocument,
} from './resource-transfer-request.schema';
import {
  ResourceTransferRequestRecord,
  ResourceTransferRequestRepository,
  TransferRequestStatus,
} from '../domain/resource-transfer-request.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoResourceTransferRequestRepository
  implements ResourceTransferRequestRepository
{
  constructor(
    @InjectModel(ResourceTransferRequest.name)
    private readonly model: Model<ResourceTransferRequestDocument>,
  ) {}

  async create(
    input: Omit<ResourceTransferRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ResourceTransferRequestRecord> {
    const doc = await this.model.create({
      organizationId: toValidObjectId(input.organizationId),
      projectId: toValidObjectId(input.projectId),
      projectName: input.projectName,
      currentAssigneeId: input.currentAssigneeId
        ? toValidObjectId(input.currentAssigneeId)
        : undefined,
      currentAssigneeName: input.currentAssigneeName || 'Unallocated',
      targetAssigneeId: toValidObjectId(input.targetAssigneeId),
      targetAssigneeName: input.targetAssigneeName,
      targetAssigneeEmail: input.targetAssigneeEmail,
      requestedById: toValidObjectId(input.requestedById),
      requestedByName: input.requestedByName,
      reason: input.reason,
      note: input.note,
      status: input.status,
    });
    return this.map(doc);
  }

  async findById(id: string): Promise<ResourceTransferRequestRecord | null> {
    const objId = toValidObjectId(id);
    const doc = await this.model.findById(objId).exec();
    return doc ? this.map(doc) : null;
  }

  async findAll(filter?: {
    organizationId?: string;
    projectId?: string;
    status?: TransferRequestStatus;
  }): Promise<ResourceTransferRequestRecord[]> {
    const q: FilterQuery<ResourceTransferRequestDocument> = {};
    if (filter?.organizationId?.trim()) {
      const orgId = toValidObjectId(filter.organizationId);
      q.organizationId = { $in: [orgId, filter.organizationId] };
    }
    if (filter?.projectId?.trim()) {
      const projId = toValidObjectId(filter.projectId);
      q.projectId = { $in: [projId, filter.projectId] };
    }
    if (filter?.status) {
      q.status = filter.status;
    }

    const docs = await this.model.find(q).sort({ createdAt: -1 }).exec();
    return docs.map((d) => this.map(d));
  }

  async update(
    id: string,
    patch: Partial<ResourceTransferRequestRecord>,
  ): Promise<ResourceTransferRequestRecord | null> {
    const objId = toValidObjectId(id);
    const updateObj: Record<string, unknown> = {};

    if (patch.status) updateObj.status = patch.status;
    if (patch.reviewedById)
      updateObj.reviewedById = toValidObjectId(patch.reviewedById);
    if (patch.reviewedByName) updateObj.reviewedByName = patch.reviewedByName;
    if (patch.reviewedAt) updateObj.reviewedAt = patch.reviewedAt;
    if (patch.reviewNote !== undefined) updateObj.reviewNote = patch.reviewNote;
    if (patch.rejectionReason !== undefined)
      updateObj.rejectionReason = patch.rejectionReason;

    const doc = await this.model
      .findByIdAndUpdate(objId, { $set: updateObj }, { new: true })
      .exec();
    return doc ? this.map(doc) : null;
  }

  private map(doc: ResourceTransferRequestDocument): ResourceTransferRequestRecord {
    return {
      id: doc.id || doc._id.toString(),
      organizationId: doc.organizationId?.toString(),
      projectId: doc.projectId?.toString(),
      projectName: doc.projectName,
      currentAssigneeId: doc.currentAssigneeId?.toString(),
      currentAssigneeName: doc.currentAssigneeName,
      targetAssigneeId: doc.targetAssigneeId?.toString(),
      targetAssigneeName: doc.targetAssigneeName,
      targetAssigneeEmail: doc.targetAssigneeEmail,
      requestedById: doc.requestedById?.toString(),
      requestedByName: doc.requestedByName,
      reason: doc.reason,
      note: doc.note,
      status: doc.status,
      reviewedById: doc.reviewedById?.toString(),
      reviewedByName: doc.reviewedByName,
      reviewedAt: doc.reviewedAt,
      reviewNote: doc.reviewNote,
      rejectionReason: doc.rejectionReason,
      createdAt: doc.createdAt ?? new Date(),
      updatedAt: doc.updatedAt ?? new Date(),
    };
  }
}
