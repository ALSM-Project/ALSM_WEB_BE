import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DeliverableDocument } from '../infrastructure/deliverable.schema';
import { DeliverableRecord } from '../domain/deliverable.types';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreateDeliverableCandidateDto } from '../presentation/deliverable.dto';

@Injectable()
export class DeliverableService {
  constructor(
    @InjectModel(DeliverableDocument.name)
    private readonly deliverableModel: Model<DeliverableDocument>,
  ) {}

  private map(doc: DeliverableDocument): DeliverableRecord {
    return {
      id: doc._id.toString(),
      projectId: doc.projectId.toString(),
      projectName: doc.projectName,
      organizationId: doc.organizationId.toString(),
      version: doc.version,
      title: doc.title,
      description: doc.description,
      packageType: doc.packageType,
      fileCount: doc.fileCount,
      totalSizeFormatted: doc.totalSizeFormatted,
      downloadUrl:
        doc.downloadUrl ||
        `/api/v1/projects/${doc.projectId.toString()}/partner-export/download`,
      status: doc.status,
      uploadedByUserId: doc.uploadedByUserId,
      uploadedByName: doc.uploadedByName,
      uploadedByRole: doc.uploadedByRole,
      teamLeadReview: doc.teamLeadReview,
      publishedAt: doc.publishedAt,
      publishedBy: doc.publishedBy,
      publishedByName: doc.publishedByName,
      customerReview: doc.customerReview,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async listForOrganization(
    organizationId: string,
    projectId?: string,
    isInternalStaff = false,
  ): Promise<DeliverableRecord[]> {
    const filter: any = {};
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    if (projectId && Types.ObjectId.isValid(projectId)) {
      filter.projectId = new Types.ObjectId(projectId);
    }

    // Role-based visibility rule:
    // Web3 Customer only sees PUBLISHED, READY_FOR_REVIEW, APPROVED, or REVISION_REQUESTED deliverables.
    // DRAFT and IN_REVIEW internal candidates remain private to ALSM engineers.
    if (!isInternalStaff) {
      filter.status = {
        $in: ['PUBLISHED', 'READY_FOR_REVIEW', 'APPROVED', 'REVISION_REQUESTED'],
      };
    }

    const docs = await this.deliverableModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((d) => this.map(d));
  }

  async getById(
    id: string,
    organizationId?: string,
    isInternalStaff = false,
  ): Promise<DeliverableRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Deliverable not found');
    }
    const filter: any = { _id: new Types.ObjectId(id) };
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    if (!isInternalStaff) {
      filter.status = {
        $in: ['PUBLISHED', 'READY_FOR_REVIEW', 'APPROVED', 'REVISION_REQUESTED'],
      };
    }

    const doc = await this.deliverableModel.findOne(filter).exec();
    if (!doc) {
      throw new NotFoundException('Deliverable not found');
    }
    return this.map(doc);
  }

  async createCandidate(
    dto: CreateDeliverableCandidateDto,
    user: AuthenticatedUser,
    organizationId: string,
    projectName = 'Enterprise Modernization Project',
  ): Promise<DeliverableRecord> {
    const doc = new this.deliverableModel({
      projectId: new Types.ObjectId(dto.projectId),
      projectName,
      organizationId: new Types.ObjectId(organizationId),
      version: dto.version,
      title: dto.title,
      description: dto.description,
      packageType: dto.packageType,
      fileCount: dto.fileCount || 0,
      totalSizeFormatted: dto.totalSizeFormatted || '1.5 MB',
      downloadUrl:
        dto.downloadUrl ||
        `/api/v1/projects/${dto.projectId}/partner-export/download`,
      status: dto.initialStatus || 'IN_REVIEW',
      uploadedByUserId: user.userId,
      uploadedByName: user.email || 'ALSM Engineer',
      uploadedByRole: (user.roles && user.roles[0]) || 'STAFF',
    });

    await doc.save();
    return this.map(doc);
  }

  async teamLeadReview(
    id: string,
    user: AuthenticatedUser,
    decision: 'APPROVED' | 'REVISION_REQUESTED',
    notes?: string,
  ): Promise<DeliverableRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Deliverable not found');
    }

    const doc = await this.deliverableModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Deliverable not found');
    }

    doc.status = decision === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED';
    doc.teamLeadReview = {
      decision,
      reviewedByUserId: user.userId,
      reviewedByUserName: user.email || 'Team Lead',
      reviewedAt: new Date(),
      feedbackNotes: notes?.trim(),
    };

    await doc.save();
    return this.map(doc);
  }

  async publish(
    id: string,
    user: AuthenticatedUser,
  ): Promise<DeliverableRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Deliverable not found');
    }

    const doc = await this.deliverableModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Deliverable not found');
    }

    doc.status = 'PUBLISHED';
    doc.publishedAt = new Date();
    doc.publishedBy = user.userId;
    doc.publishedByName = user.email || 'ALSM Admin';

    await doc.save();
    return this.map(doc);
  }

  async reviewDeliverable(
    id: string,
    organizationId: string,
    user: AuthenticatedUser,
    decision: 'APPROVED' | 'REVISION_REQUESTED',
    feedbackNotes?: string,
  ): Promise<DeliverableRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Deliverable not found');
    }
    if (
      decision === 'REVISION_REQUESTED' &&
      (!feedbackNotes || feedbackNotes.trim().length < 5)
    ) {
      throw new BadRequestException(
        'A revision explanation of at least 5 characters is required.',
      );
    }

    const doc = await this.deliverableModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    if (!doc) {
      throw new NotFoundException('Deliverable not found');
    }

    doc.status = decision === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED';
    doc.customerReview = {
      decision,
      reviewedByUserId: user.userId,
      reviewedByUserName: user.email || 'Customer Partner',
      reviewedAt: new Date(),
      feedbackNotes: feedbackNotes?.trim(),
    };

    await doc.save();
    return this.map(doc);
  }

  async create(data: Partial<DeliverableDocument>): Promise<DeliverableRecord> {
    const doc = new this.deliverableModel(data);
    await doc.save();
    return this.map(doc);
  }
}
