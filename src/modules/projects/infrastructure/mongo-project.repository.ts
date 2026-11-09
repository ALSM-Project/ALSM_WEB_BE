import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Project, ProjectDocument } from './project.schema';
import {
  ManagedProjectStage,
  ProjectAcceptanceRecord,
  ProjectRecord,
  ProjectRepository,
  ProjectStatus,
} from '../domain/project.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoProjectRepository implements ProjectRepository {
  constructor(@InjectModel(Project.name) private readonly model: Model<Project>) {}

  async create(
    input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<ProjectRecord> {
    const customId = input.id ? toValidObjectId(input.id) : undefined;
    return this.map(
      await this.model.create({
        ...input,
        ...(customId ? { _id: customId } : {}),
        organizationId: toValidObjectId(input.organizationId),
        createdBy: toValidObjectId(input.createdBy),
        conversionRequestId: input.conversionRequestId
          ? toValidObjectId(input.conversionRequestId)
          : undefined,
        assignedTeamLeadId: input.assignedTeamLeadId
          ? toValidObjectId(input.assignedTeamLeadId)
          : undefined,
        assignedStaffId: input.assignedStaffId
          ? toValidObjectId(input.assignedStaffId)
          : undefined,
        staffAssignedBy: input.staffAssignedBy
          ? toValidObjectId(input.staffAssignedBy)
          : undefined,
        teamLeadAssignedBy: input.teamLeadAssignedBy
          ? toValidObjectId(input.teamLeadAssignedBy)
          : undefined,
        submittedBy: input.submittedBy ? toValidObjectId(input.submittedBy) : undefined,
      }),
    );
  }

  async findById(id: string, organizationId?: string): Promise<ProjectRecord | null> {
    if (!organizationId?.trim()) return null;

    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);

    const doc = await this.model
      .findOne({
        $or: [{ _id: projObjId }, { name: id }],
        organizationId: { $in: [orgObjId, organizationId] },
        deletedAt: { $exists: false },
      })
      .exec();

    return doc ? this.map(doc) : null;
  }

  async findAll(organizationId?: string): Promise<ProjectRecord[]> {
    const filter: FilterQuery<ProjectDocument> = { deletedAt: { $exists: false } };
    if (organizationId?.trim()) {
      const orgObjId = toValidObjectId(organizationId);
      filter.organizationId = { $in: [orgObjId, organizationId] };
    }
    return (await this.model.find(filter).sort({ createdAt: -1 }).exec()).map((doc) => this.map(doc));
  }

  async update(
    id: string,
    organizationId: string,
    input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status' | 'assignedTeamLeadId' | 'currentStage' | 'stageIndex' | 'progressPct' | 'adminReviewNotes'>>,
  ): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: projObjId,
          organizationId: { $in: [orgObjId, organizationId] },
          deletedAt: { $exists: false },
        },
        { $set: input },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async assignTeamLead(
    id: string,
    assignment: {
      teamLeadId: string;
      teamLeadName?: string;
      assignedBy: string;
      assignedByName?: string;
      note?: string;
    },
  ): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: projObjId, deletedAt: { $exists: false } },
        {
          $set: {
            assignedTeamLeadId: toValidObjectId(assignment.teamLeadId),
            assignedTeamLeadName: assignment.teamLeadName,
            teamLeadAssignedBy: toValidObjectId(assignment.assignedBy),
            teamLeadAssignedByName: assignment.assignedByName,
            teamLeadAssignedAt: new Date(),
            teamLeadAssignmentNote: assignment.note || '',
            teamLeadAssignmentStatus: 'ASSIGNED',
            status: ProjectStatus.IN_PROGRESS,
            currentStage: ManagedProjectStage.LEGACY_ANALYSIS,
            stageIndex: 2,
            progressPct: 22,
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async updateStage(
    id: string,
    stage: ManagedProjectStage,
    stageIndex: number,
    progressPct: number,
    status?: ProjectStatus,
  ): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const updateSet: any = {
      currentStage: stage,
      stageIndex,
      progressPct,
    };
    if (status) {
      updateSet.status = status;
    }
    const doc = await this.model
      .findOneAndUpdate(
        { _id: projObjId, deletedAt: { $exists: false } },
        { $set: updateSet },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async recordAcceptance(
    id: string,
    acceptance: ProjectAcceptanceRecord,
  ): Promise<ProjectRecord | null> {
    const projObjId = toValidObjectId(id);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: projObjId, deletedAt: { $exists: false } },
        {
          $set: {
            acceptance,
            status: ProjectStatus.COMPLETED,
            currentStage: ManagedProjectStage.DELIVERY,
            stageIndex: 9,
            progressPct: 100,
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async findByAssignedStaff(staffId: string, organizationId?: string): Promise<ProjectRecord[]> {
    const filter: FilterQuery<ProjectDocument> = {
      deletedAt: { $exists: false },
      assignedStaffId: toValidObjectId(staffId),
    };
    if (organizationId?.trim()) {
      filter.organizationId = { $in: [toValidObjectId(organizationId), organizationId] };
    }
    return (await this.model.find(filter).sort({ createdAt: -1 }).exec()).map((doc) => this.map(doc));
  }

  async assignStaff(
    id: string,
    staff: { staffId: string; staffName: string; note?: string; assignedBy: string },
  ): Promise<ProjectRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: toValidObjectId(id), deletedAt: { $exists: false } },
        {
          $set: {
            assignedStaffId: toValidObjectId(staff.staffId),
            assignedStaffName: staff.staffName,
            staffAssignmentNote: staff.note ?? '',
            staffAssignedBy: toValidObjectId(staff.assignedBy),
            staffAssignedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async removeStaff(id: string): Promise<ProjectRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: toValidObjectId(id), deletedAt: { $exists: false } },
        {
          $unset: {
            assignedStaffId: 1,
            assignedStaffName: 1,
            staffAssignmentNote: 1,
            staffAssignedBy: 1,
            staffAssignedAt: 1,
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async softDelete(id: string, organizationId: string): Promise<boolean> {
    const projObjId = toValidObjectId(id);
    const orgObjId = toValidObjectId(organizationId);
    const result = await this.model
      .updateOne(
        {
          _id: projObjId,
          organizationId: { $in: [orgObjId, organizationId] },
          deletedAt: { $exists: false },
        },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  private map(doc: ProjectDocument): ProjectRecord {
    return {
      id: doc.id,
      organizationId: (doc.organizationId || '').toString(),
      name: doc.name,
      description: doc.description,
      conversionType: doc.conversionType,
      status: doc.status,
      createdBy: (doc.createdBy || doc._id || '').toString(),
      serviceType: doc.serviceType,
      conversionRequestId: doc.conversionRequestId?.toString(),
      contractNumber: doc.contractNumber,
      contractId: doc.contractId,
      currentStage: doc.currentStage,
      stageIndex: doc.stageIndex ?? 1,
      progressPct: doc.progressPct ?? 11,
      submittedAt: doc.submittedAt,
      submittedBy: doc.submittedBy?.toString(),
      businessRequirements: doc.businessRequirements,
      adminReviewNotes: doc.adminReviewNotes,
      reviewedBy: doc.reviewedBy?.toString(),
      reviewedAt: doc.reviewedAt,
      isDemo: doc.isDemo,
      assignedTeamLeadId: doc.assignedTeamLeadId?.toString(),
      assignedTeamLeadName: doc.assignedTeamLeadName,
      teamLeadAssignedBy: doc.teamLeadAssignedBy?.toString(),
      teamLeadAssignedByName: doc.teamLeadAssignedByName,
      teamLeadAssignedAt: doc.teamLeadAssignedAt,
      teamLeadAssignmentNote: doc.teamLeadAssignmentNote,
      teamLeadAssignmentStatus: (doc.teamLeadAssignmentStatus as any) || 'ASSIGNED',
      assignedStaffId: doc.assignedStaffId?.toString(),
      assignedStaffName: doc.assignedStaffName,
      staffAssignmentNote: doc.staffAssignmentNote,
      staffAssignedBy: doc.staffAssignedBy?.toString(),
      staffAssignedAt: doc.staffAssignedAt,
      files: (doc.files || []).map((f) => ({
        fileId: f.fileId,
        originalName: f.originalName,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
        category: f.category,
        storageKey: f.storageKey,
        uploadedAt: f.uploadedAt,
      })),
      acceptance: doc.acceptance
        ? {
            accepted: doc.acceptance.accepted,
            acceptedBy: doc.acceptance.acceptedBy || '',
            acceptedByName: doc.acceptance.acceptedByName,
            acceptedAt: doc.acceptance.acceptedAt || new Date(),
            notes: doc.acceptance.notes,
          }
        : undefined,
      isExported: doc.isExported,
      exportedAt: doc.exportedAt,
      exportedBundleName: doc.exportedBundleName,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      deletedAt: doc.deletedAt,
    };
  }
}
