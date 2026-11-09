import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ConversionRequest,
  ConversionRequestDocument,
} from '../infrastructure/conversion-request.schema';
import {
  ConversionRequestStatus,
  ManagedConversionPipeline,
} from '../domain/conversion-request.types';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import {
  ConversionType,
  ManagedProjectStage,
  ProjectStatus,
} from '../../projects/domain/project.types';

export interface CreateConversionRequestDto {
  projectName: string;
  projectDescription?: string;
  businessDomain?: string;
  contractNumber?: string;
  contractId?: string;
  businessRequirements?: string;
  pipeline?: ManagedConversionPipeline;
  sourceTechnology?: string;
  targetArchitecture?: string;
  scope?: {
    estimatedScreens?: number;
    estimatedPrograms?: number;
    estimatedLinesOfCode?: number;
    complexity?: string;
  };
  contact: {
    name: string;
    email: string;
    phone?: string;
    role?: string;
  };
  specialInstructions?: string;
  expectedDeliverables?: string;
  preferredTimelineWeeks?: number;
  files?: Array<{
    fileId: string;
    originalName: string;
    fileSize: number;
    mimeType?: string;
    category?: string;
    storageKey?: string;
  }>;
}

export interface ReviewConversionRequestDto {
  status:
    | ConversionRequestStatus.UNDER_REVIEW
    | ConversionRequestStatus.ACCEPTED
    | ConversionRequestStatus.REJECTED;
  feedback?: string;
}

@Injectable()
export class ConversionRequestService {
  private readonly logger = new Logger(ConversionRequestService.name);

  constructor(
    @InjectModel(ConversionRequest.name)
    private readonly requestModel: Model<ConversionRequestDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
  ) {}

  private async generateRequestNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.requestModel.countDocuments();
    const sequence = String(count + 1).padStart(4, '0');
    return `CR-${year}-${sequence}`;
  }

  async create(
    dto: CreateConversionRequestDto,
    user: { userId: string; email: string },
    organizationId: string,
  ): Promise<ConversionRequestDocument> {
    if (!dto.projectName?.trim()) {
      throw new BadRequestException('Project name is required');
    }
    if (!dto.contact?.name || !dto.contact?.email) {
      throw new BadRequestException('Contact name and email are required');
    }

    const requestNumber = await this.generateRequestNumber();
    const orgObjId = new Types.ObjectId(organizationId);
    const userObjId = new Types.ObjectId(user.userId);

    const formattedFiles = (dto.files || []).map((f) => ({
      fileId: f.fileId || `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      originalName: f.originalName,
      fileSize: f.fileSize,
      mimeType: f.mimeType || 'application/octet-stream',
      category: f.category || 'SOURCE_CODE',
      uploadedAt: new Date(),
      storageKey: f.storageKey,
    }));

    const conversionType =
      dto.pipeline === ManagedConversionPipeline.COBOL_TO_JAVA
        ? ConversionType.COBOL_TO_JAVA
        : ConversionType.BMS_DSPF_TO_FRONTEND;

    // 1. Create ConversionRequest
    const created = new this.requestModel({
      organizationId: orgObjId,
      requestNumber,
      contractNumber: dto.contractNumber?.trim(),
      contractId: dto.contractId?.trim(),
      projectName: dto.projectName.trim(),
      projectDescription: dto.projectDescription?.trim(),
      businessDomain: dto.businessDomain?.trim(),
      businessRequirements:
        dto.businessRequirements?.trim() ||
        dto.specialInstructions?.trim() ||
        dto.expectedDeliverables?.trim(),
      pipeline: dto.pipeline || ManagedConversionPipeline.BMS_DSPF_TO_FRONTEND,
      sourceTechnology: dto.sourceTechnology || 'IBM Mainframe BMS / DSPF Screen Definitions',
      targetArchitecture: dto.targetArchitecture || 'React 19, TypeScript & Tailwind CSS',
      scope: {
        estimatedScreens: dto.scope?.estimatedScreens || 0,
        estimatedPrograms: dto.scope?.estimatedPrograms || 0,
        estimatedLinesOfCode: dto.scope?.estimatedLinesOfCode || 0,
        complexity: dto.scope?.complexity || 'MEDIUM',
      },
      contact: {
        name: dto.contact.name.trim(),
        email: dto.contact.email.trim(),
        phone: dto.contact.phone?.trim(),
        role: dto.contact.role?.trim(),
      },
      specialInstructions: dto.specialInstructions?.trim(),
      expectedDeliverables: dto.expectedDeliverables?.trim(),
      preferredTimelineWeeks: dto.preferredTimelineWeeks,
      files: formattedFiles,
      status: ConversionRequestStatus.SUBMITTED,
      submittedAt: new Date(),
      createdBy: userObjId,
    });

    const savedRequest = await created.save();

    // 2. Automatically create linked Project record with initial status SUBMITTED & stage REQUIREMENTS_GATHERING
    const newProject = new this.projectModel({
      organizationId: orgObjId,
      name: `${dto.projectName.trim()} (Managed)`,
      description: dto.projectDescription?.trim() || `Managed modernization for ${dto.projectName.trim()}`,
      conversionType,
      status: ProjectStatus.SUBMITTED,
      serviceType: 'MANAGED',
      contractNumber: dto.contractNumber?.trim(),
      contractId: dto.contractId?.trim(),
      currentStage: ManagedProjectStage.REQUIREMENTS_GATHERING,
      stageIndex: 1,
      progressPct: 11,
      submittedAt: new Date(),
      submittedBy: userObjId,
      businessRequirements:
        dto.businessRequirements?.trim() ||
        dto.specialInstructions?.trim() ||
        dto.expectedDeliverables?.trim(),
      files: formattedFiles,
      conversionRequestId: savedRequest._id,
      createdBy: userObjId,
    });

    const savedProject = await newProject.save();

    // 3. Link project in request
    savedRequest.linkedProjectId = savedProject._id as Types.ObjectId;
    return savedRequest.save();
  }

  async listOrganizationRequests(
    organizationId?: string,
    query?: { status?: string; search?: string; page?: number; limit?: number },
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const filter: any = {};
    if (organizationId && organizationId !== 'ALL') {
      filter.organizationId = new Types.ObjectId(organizationId);
    }

    if (query?.status && query.status !== 'ALL') {
      filter.status = query.status;
    }

    if (query?.search?.trim()) {
      const regex = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { projectName: regex },
        { requestNumber: regex },
        { 'contact.name': regex },
        { contractNumber: regex },
      ];
    }

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.requestModel.countDocuments(filter),
    ]);

    return {
      items: items.map((i) => ({ ...i, id: String(i._id) })),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getById(id: string, organizationId?: string): Promise<any> {
    const filter: any = { _id: new Types.ObjectId(id) };
    if (organizationId && organizationId !== 'ALL') {
      filter.organizationId = new Types.ObjectId(organizationId);
    }
    const item = await this.requestModel.findOne(filter).lean().exec();
    if (!item) {
      throw new NotFoundException('Conversion request not found');
    }
    return { ...item, id: String(item._id) };
  }

  async reviewRequest(
    id: string,
    dto: ReviewConversionRequestDto,
    reviewer: { userId: string; email: string },
  ): Promise<any> {
    const request = await this.requestModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException('Conversion request not found');
    }

    request.status = dto.status;
    if (dto.feedback) {
      request.reviewFeedback = dto.feedback;
    }
    request.reviewedAt = new Date();
    request.reviewedBy = new Types.ObjectId(reviewer.userId);

    const saved = await request.save();

    // Synchronize linked project status
    if (request.linkedProjectId) {
      let linkedProjectStatus = ProjectStatus.SUBMITTED;
      if (dto.status === ConversionRequestStatus.ACCEPTED) {
        linkedProjectStatus = ProjectStatus.READY_FOR_ASSIGNMENT;
      } else if (dto.status === ConversionRequestStatus.REJECTED) {
        linkedProjectStatus = ProjectStatus.REJECTED;
      } else if (dto.status === ConversionRequestStatus.UNDER_REVIEW) {
        linkedProjectStatus = ProjectStatus.PENDING_REVIEW;
      }

      await this.projectModel
        .findByIdAndUpdate(request.linkedProjectId, {
          $set: {
            status: linkedProjectStatus,
            adminReviewNotes: dto.feedback || '',
            reviewedBy: new Types.ObjectId(reviewer.userId),
            reviewedAt: new Date(),
          },
        })
        .exec();
    }

    return { ...saved.toObject(), id: String(saved._id) };
  }

  async createProjectFromRequest(
    id: string,
    adminUser: { userId: string; email: string },
  ): Promise<{ request: any; project: any }> {
    const request = await this.requestModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException('Conversion request not found');
    }

    if (request.linkedProjectId) {
      const existingProject = await this.projectModel.findById(request.linkedProjectId).lean().exec();
      if (existingProject) {
        return { request: { ...request.toObject(), id: String(request._id) }, project: existingProject };
      }
    }

    const conversionType =
      request.pipeline === ManagedConversionPipeline.COBOL_TO_JAVA
        ? ConversionType.COBOL_TO_JAVA
        : ConversionType.BMS_DSPF_TO_FRONTEND;

    const newProject = new this.projectModel({
      organizationId: request.organizationId,
      name: `${request.projectName} (Managed)`,
      description: request.projectDescription || `Managed conversion for ${request.projectName}`,
      conversionType,
      status: ProjectStatus.READY_FOR_ASSIGNMENT,
      serviceType: 'MANAGED',
      contractNumber: request.contractNumber,
      contractId: request.contractId,
      currentStage: ManagedProjectStage.REQUIREMENTS_GATHERING,
      stageIndex: 1,
      progressPct: 11,
      conversionRequestId: request._id,
      createdBy: new Types.ObjectId(adminUser.userId),
    });

    const savedProject = await newProject.save();

    request.status = ConversionRequestStatus.PROJECT_CREATED;
    request.linkedProjectId = savedProject._id as Types.ObjectId;
    request.projectCreatedAt = new Date();
    await request.save();

    return {
      request: { ...request.toObject(), id: String(request._id) },
      project: { ...savedProject.toObject(), id: String(savedProject._id) },
    };
  }

  async getWorkspaceMetrics(organizationId: string): Promise<{
    totalProjects: number;
    selfServiceProjects: number;
    managedProjects: number;
    activeProjects: number;
    completedProjects: number;
    pendingRequests: number;
  }> {
    const orgId = new Types.ObjectId(organizationId);

    const [allProjects, pendingRequests] = await Promise.all([
      this.projectModel.find({ organizationId: orgId, deletedAt: null }).lean().exec(),
      this.requestModel.countDocuments({
        organizationId: orgId,
        status: { $in: [ConversionRequestStatus.SUBMITTED, ConversionRequestStatus.UNDER_REVIEW] },
      }),
    ]);

    const totalProjects = allProjects.length;
    const managedProjects = allProjects.filter((p) => (p as any).serviceType === 'MANAGED').length;
    const selfServiceProjects = totalProjects - managedProjects;
    const activeProjects = allProjects.filter((p) => p.status === ProjectStatus.ACTIVE || (p as any).status === ProjectStatus.IN_PROGRESS).length;
    const completedProjects = allProjects.filter((p) => p.status === ProjectStatus.COMPLETED).length;

    return {
      totalProjects,
      selfServiceProjects,
      managedProjects,
      activeProjects,
      completedProjects,
      pendingRequests,
    };
  }
}
