import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IOffboardingRequestRepository,
  OffboardingRequestRecord,
  OffboardingRequestStatus,
} from '../domain/offboarding-request.types';
import {
  OffboardingRequest,
  OffboardingRequestDocument,
} from './offboarding-request.schema';

@Injectable()
export class MongoOffboardingRequestRepository implements IOffboardingRequestRepository {
  constructor(
    @InjectModel(OffboardingRequest.name)
    private readonly requestModel: Model<OffboardingRequestDocument>,
  ) {}

  async create(
    input: Omit<OffboardingRequestRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OffboardingRequestRecord> {
    const created = await this.requestModel.create({
      organizationId: new Types.ObjectId(input.organizationId),
      teamId: input.teamId ? new Types.ObjectId(input.teamId) : undefined,
      teamName: input.teamName,
      targetUserId: new Types.ObjectId(input.targetUserId),
      targetUserName: input.targetUserName,
      targetUserEmail: input.targetUserEmail,
      targetUserRoles: input.targetUserRoles || [],
      requestedById: new Types.ObjectId(input.requestedById),
      requestedByName: input.requestedByName,
      requestedByEmail: input.requestedByEmail,
      transferToUserId: input.transferToUserId
        ? new Types.ObjectId(input.transferToUserId)
        : undefined,
      transferToUserName: input.transferToUserName,
      projectTransfers: input.projectTransfers || [],
      reason: input.reason,
      note: input.note,
      status: input.status,
      reviewedById: input.reviewedById
        ? new Types.ObjectId(input.reviewedById)
        : undefined,
      reviewedByName: input.reviewedByName,
      reviewedAt: input.reviewedAt,
      reviewNote: input.reviewNote,
      rejectionReason: input.rejectionReason,
      executionResult: input.executionResult,
    });

    return this.mapToRecord(created);
  }

  async findById(id: string): Promise<OffboardingRequestRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.requestModel.findById(id).lean().exec();
    return doc ? this.mapToRecord(doc) : null;
  }

  async findPendingByTargetUser(targetUserId: string): Promise<OffboardingRequestRecord | null> {
    if (!Types.ObjectId.isValid(targetUserId)) return null;
    const doc = await this.requestModel
      .findOne({
        targetUserId: new Types.ObjectId(targetUserId),
        status: 'PENDING',
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return doc ? this.mapToRecord(doc) : null;
  }

  async findAll(filter?: {
    organizationId?: string;
    teamId?: string;
    targetUserId?: string;
    requestedById?: string;
    status?: OffboardingRequestStatus;
  }): Promise<OffboardingRequestRecord[]> {
    const query: Record<string, unknown> = {};

    if (filter?.organizationId && Types.ObjectId.isValid(filter.organizationId)) {
      query.organizationId = new Types.ObjectId(filter.organizationId);
    }
    if (filter?.teamId && Types.ObjectId.isValid(filter.teamId)) {
      query.teamId = new Types.ObjectId(filter.teamId);
    }
    if (filter?.targetUserId && Types.ObjectId.isValid(filter.targetUserId)) {
      query.targetUserId = new Types.ObjectId(filter.targetUserId);
    }
    if (filter?.requestedById && Types.ObjectId.isValid(filter.requestedById)) {
      query.requestedById = new Types.ObjectId(filter.requestedById);
    }
    if (filter?.status) {
      query.status = filter.status;
    }

    const docs = await this.requestModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return docs.map((doc) => this.mapToRecord(doc));
  }

  async update(
    id: string,
    patch: Partial<OffboardingRequestRecord>,
  ): Promise<OffboardingRequestRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;

    const updateDoc: Record<string, unknown> = {};
    if (patch.status) updateDoc.status = patch.status;
    if (patch.reviewedById) {
      updateDoc.reviewedById = new Types.ObjectId(patch.reviewedById);
    }
    if (patch.reviewedByName !== undefined) {
      updateDoc.reviewedByName = patch.reviewedByName;
    }
    if (patch.reviewedAt !== undefined) updateDoc.reviewedAt = patch.reviewedAt;
    if (patch.reviewNote !== undefined) updateDoc.reviewNote = patch.reviewNote;
    if (patch.rejectionReason !== undefined) {
      updateDoc.rejectionReason = patch.rejectionReason;
    }
    if (patch.executionResult !== undefined) {
      updateDoc.executionResult = patch.executionResult;
    }
    if (patch.transferToUserId !== undefined) {
      updateDoc.transferToUserId = patch.transferToUserId
        ? new Types.ObjectId(patch.transferToUserId)
        : undefined;
    }
    if (patch.transferToUserName !== undefined) {
      updateDoc.transferToUserName = patch.transferToUserName;
    }
    if (patch.projectTransfers !== undefined) {
      updateDoc.projectTransfers = patch.projectTransfers;
    }

    const updated = await this.requestModel
      .findByIdAndUpdate(id, { $set: updateDoc }, { new: true })
      .lean()
      .exec();

    return updated ? this.mapToRecord(updated) : null;
  }

  private mapToRecord(
    doc:
      | OffboardingRequestDocument
      | (OffboardingRequest & {
          _id?: Types.ObjectId;
          id?: string;
          createdAt?: Date;
          updatedAt?: Date;
        }),
  ): OffboardingRequestRecord {
    return {
      id: doc._id?.toString() || doc.id,
      organizationId: doc.organizationId?.toString(),
      teamId: doc.teamId?.toString(),
      teamName: doc.teamName,
      targetUserId: doc.targetUserId?.toString(),
      targetUserName: doc.targetUserName,
      targetUserEmail: doc.targetUserEmail,
      targetUserRoles: doc.targetUserRoles || [],
      requestedById: doc.requestedById?.toString(),
      requestedByName: doc.requestedByName,
      requestedByEmail: doc.requestedByEmail,
      transferToUserId: doc.transferToUserId?.toString(),
      transferToUserName: doc.transferToUserName,
      projectTransfers: doc.projectTransfers || [],
      reason: doc.reason,
      note: doc.note,
      status: doc.status,
      reviewedById: doc.reviewedById?.toString(),
      reviewedByName: doc.reviewedByName,
      reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt) : undefined,
      reviewNote: doc.reviewNote,
      rejectionReason: doc.rejectionReason,
      executionResult: doc.executionResult,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
    };
  }
}
