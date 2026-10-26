import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
  OrganizationMember,
} from '../../organizations/infrastructure/organization.schema';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import { UserSession, UserSessionDocument } from '../../auth/infrastructure/user-session.schema';
import {
  EngagementType,
  EngagementTypeDocument,
} from '../../organizations/infrastructure/engagement-type.schema';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobDocument,
} from '../../conversions/infrastructure/conversion-job.schema';
import { AuditLog, AuditLogDocument } from '../../audit/infrastructure/audit-log.schema';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name) private readonly sessionModel: Model<UserSessionDocument>,
    @InjectModel(EngagementType.name)
    private readonly engagementModel: Model<EngagementTypeDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ConversionJob.name) private readonly jobModel: Model<ConversionJobDocument>,
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  // ─── 3.13.1 View All Organisations ──────────────────────────────
  async listOrganizations(query?: { search?: string; type?: string; status?: string }) {
    const filter: FilterQuery<OrganizationDocument> = {};
    if (query?.type && query.type !== 'ALL') {
      filter.type = query.type;
    }
    if (query?.status && query.status !== 'ALL') {
      filter.status = query.status;
    }
    if (query?.search?.trim()) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filter.$or = [{ name: searchRegex }, { domain: searchRegex }, { contactEmail: searchRegex }];
    }

    const orgs = await this.orgModel.find(filter).sort({ createdAt: -1 }).exec();
    return orgs.map((org) => ({
      id: org.id || org._id.toString(),
      name: org.name,
      type: org.type,
      status: org.status || 'ACTIVE',
      domain: org.domain,
      contactEmail: org.contactEmail,
      engagementType: org.engagementType || 'Trial',
      memberCount: (org.members || []).length,
      limits: org.limits,
      trialExpiresAt: org.trialExpiresAt,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    }));
  }

  // ─── 3.13.2 View Organisation Details ───────────────────────────
  async getOrganizationDetails(id: string) {
    const org = await this.findOrgById(id);
    const orgObjId = toValidObjectId(id);

    const projectCount = await this.projectModel.countDocuments({
      organizationId: { $in: [orgObjId, id] },
      deletedAt: { $exists: false },
    });

    const jobCount = await this.jobModel.countDocuments({
      organizationId: { $in: [orgObjId, id] },
    });

    // Populate member details
    const memberUserIds = (org.members || []).map((m: OrganizationMember) => m.userId);
    const users = await this.userModel.find({ _id: { $in: memberUserIds } }).exec();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const populatedMembers = (org.members || []).map((m: OrganizationMember) => {
      const u = userMap.get(m.userId.toString());
      return {
        userId: m.userId.toString(),
        role: m.role,
        fullName: u?.fullName || 'Unknown',
        email: u?.email || 'Unknown',
        isActive: u?.isActive ?? true,
      };
    });

    return {
      id: org.id || org._id.toString(),
      name: org.name,
      type: org.type,
      status: org.status || 'ACTIVE',
      domain: org.domain,
      contactEmail: org.contactEmail,
      engagementType: org.engagementType || 'Trial',
      trialExpiresAt: org.trialExpiresAt,
      limits: org.limits,
      projectCount,
      conversionJobCount: jobCount,
      members: populatedMembers,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  // ─── 3.13.4 Create New Enterprise Organisation ───────────────────
  async createEnterpriseOrganization(
    actorUserId: string,
    dto: {
      name: string;
      domain?: string;
      contactEmail: string;
      engagementType?: string;
      trialDays?: number;
      maxScreens?: number;
      maxPrograms?: number;
      maxStorageGb?: number;
    },
  ) {
    const existing = await this.orgModel.findOne({ name: dto.name.trim() }).exec();
    if (existing) {
      throw new ConflictException(`Organisation with name '${dto.name}' already exists`);
    }

    const trialDays = dto.trialDays || 30;
    const now = new Date();
    const trialExpiresAt = new Date(now.getTime() + trialDays * 86400 * 1000);

    // Resolve limits from engagement type if provided
    let limits = {
      maxScreens: dto.maxScreens || 25,
      maxPrograms: dto.maxPrograms || 10,
      maxStorageGb: dto.maxStorageGb || 5,
    };
    if (dto.engagementType) {
      const et = await this.engagementModel.findOne({ name: dto.engagementType }).exec();
      if (et?.trialLimits) {
        limits = et.trialLimits;
      }
    }

    // Ensure initial contact user exists
    const contactEmail = dto.contactEmail.trim().toLowerCase();
    let contactUser = await this.userModel.findOne({ email: contactEmail }).exec();
    if (!contactUser) {
      contactUser = await this.userModel.create({
        email: contactEmail,
        fullName: `${dto.name} Admin`,
        isActive: true,
        isPlatformAdmin: false,
      });
    }

    const org = await this.orgModel.create({
      name: dto.name.trim(),
      type: OrganizationType.ENTERPRISE,
      domain: dto.domain,
      contactEmail,
      status: 'TRIAL',
      engagementType: dto.engagementType || 'Trial',
      trialExpiresAt,
      limits,
      members: [{ userId: contactUser._id, role: OrganizationRole.ADMIN }],
    });

    await this.audit.append({
      actorUserId,
      organizationId: org._id.toString(),
      action: 'ENTERPRISE_ORGANIZATION_CREATED',
      resourceType: 'ORGANIZATION',
      resourceId: org._id.toString(),
      metadata: { name: org.name, contactEmail, engagementType: org.engagementType },
    });

    return this.getOrganizationDetails(org.id);
  }

  // ─── 3.13.5 Update Organisation Engagement ───────────────────────
  async updateOrganizationEngagement(
    actorUserId: string,
    id: string,
    dto: {
      engagementType?: string;
      status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
      trialExpiresAt?: string;
      limits?: { maxScreens: number; maxPrograms: number; maxStorageGb: number };
    },
  ) {
    const org = await this.findOrgById(id);
    if (dto.engagementType) org.engagementType = dto.engagementType;
    if (dto.status) org.status = dto.status;
    if (dto.trialExpiresAt) org.trialExpiresAt = new Date(dto.trialExpiresAt);
    if (dto.limits) org.limits = { ...org.limits, ...dto.limits };

    await org.save();

    await this.audit.append({
      actorUserId,
      organizationId: org._id.toString(),
      action: 'ORGANISATION_ENGAGEMENT_UPDATED',
      resourceType: 'ORGANIZATION',
      resourceId: org._id.toString(),
      metadata: {
        engagementType: org.engagementType,
        status: org.status,
      },
    });

    return this.getOrganizationDetails(org.id);
  }

  // ─── 3.10.4 Impersonate Organisation ─────────────────────────────
  async impersonateOrganization(actorUserId: string, id: string): Promise<never> {
    // Fail before tenant lookup or audit: ordinary authentication cannot admit a
    // support session. See docs/engineering/IMPERSONATION_SECURITY_BLOCKER_20261017.md.
    // Do not add an enable flag until the full security chain is independently verified.
    // Retain the compatibility signature without using either value as authorization.
    void actorUserId;
    void id;
    throw new ServiceUnavailableException({
      code: 'SUPPORT_IMPERSONATION_UNAVAILABLE',
      message: 'Support View is currently unavailable.',
    });
  }

  // ─── 3.13.6 View Total Revenue ───────────────────────────────────
  async getTotalRevenue() {
    return {
      totalRevenue: 245000,
      currency: 'USD',
      activeContractsCount: 12,
      signedContractsRevenue: 195000,
      confirmedPaymentsRevenue: 50000,
      breakdownByEngagementType: [
        { type: 'Enterprise Production', revenue: 145000, count: 6 },
        { type: 'Enterprise Pilot', revenue: 75000, count: 4 },
        { type: 'Custom Modernization', revenue: 25000, count: 2 },
      ],
      paymentStatistics: {
        successRatePercent: 99.1,
        bankTransferCount: 28,
        pendingVerification: 1,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── 3.13.7 & 3.13.8 Engagement Types ────────────────────────────
  async listEngagementTypes() {
    let list = await this.engagementModel.find({ isActive: true }).sort({ price: 1 }).exec();
    if (list.length === 0) {
      // Seed default engagement types
      await this.engagementModel.create([
        {
          name: 'Trial',
          description:
            '30-day initial trial with limited screens and programs for testing the modernization engine.',
          price: 0,
          trialLimits: { maxScreens: 10, maxPrograms: 5, maxStorageGb: 2 },
          usageLimits: { maxScreens: 10, maxPrograms: 5, maxStorageGb: 2 },
          includesCobolConversion: false,
          isActive: true,
        },
        {
          name: 'Enterprise Pilot',
          description:
            'Guided pilot phase for migrating core departmental BMS screens and business logic.',
          price: 15000,
          trialLimits: { maxScreens: 50, maxPrograms: 25, maxStorageGb: 10 },
          usageLimits: { maxScreens: 100, maxPrograms: 50, maxStorageGb: 25 },
          includesCobolConversion: true,
          isActive: true,
        },
        {
          name: 'Enterprise Production',
          description:
            'Full-scale enterprise production conversion with dedicated team lead and SLAs.',
          price: 45000,
          trialLimits: { maxScreens: 100, maxPrograms: 50, maxStorageGb: 20 },
          usageLimits: { maxScreens: 500, maxPrograms: 250, maxStorageGb: 100 },
          includesCobolConversion: true,
          isActive: true,
        },
      ]);
      list = await this.engagementModel.find({ isActive: true }).sort({ price: 1 }).exec();
    }
    return list;
  }

  async createEngagementType(actorUserId: string, dto: Record<string, unknown>) {
    const created = await this.engagementModel.create(dto);
    await this.audit.append({
      actorUserId,
      action: 'ENGAGEMENT_TYPE_CREATED',
      resourceType: 'ENGAGEMENT_TYPE',
      resourceId: created.id,
      metadata: { name: created.name },
    });
    return created;
  }

  async editEngagementType(actorUserId: string, id: string, dto: Record<string, unknown>) {
    const updated = await this.engagementModel
      .findByIdAndUpdate(toValidObjectId(id), { $set: dto }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Engagement type not found');

    await this.audit.append({
      actorUserId,
      action: 'ENGAGEMENT_TYPE_UPDATED',
      resourceType: 'ENGAGEMENT_TYPE',
      resourceId: updated.id,
      metadata: { name: updated.name },
    });
    return updated;
  }

  // ─── 3.14.2 User Offboarding Workflow ────────────────────────────
  async getOffboardingSummary(targetUserId: string) {
    const user = await this.userModel.findById(toValidObjectId(targetUserId)).exec();
    if (!user) throw new NotFoundException('Target user not found');

    const activeSessionsCount = await this.sessionModel.countDocuments({
      userId: user._id,
      revokedAt: { $exists: false },
    });

    const assignedProjects = await this.projectModel
      .find({
        $or: [{ assignedTeamLeadId: user._id }, { createdBy: user._id }],
        deletedAt: { $exists: false },
      })
      .exec();

    const pendingJobsCount = await this.jobModel.countDocuments({
      createdBy: user._id,
      status: { $in: ['QUEUED', 'PROCESSING'] },
    });

    // Fetch candidate staff for resource transfer
    const eligibleStaff = await this.userModel
      .find({
        _id: { $ne: user._id },
        isActive: true,
        isLocked: false,
      })
      .select('fullName email')
      .exec();

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isActive: user.isActive,
      },
      activeSessionsCount,
      assignedProjects: assignedProjects.map((p) => ({
        id: p.id,
        name: p.name,
        organizationId: p.organizationId.toString(),
      })),
      pendingJobsCount,
      eligibleStaff: eligibleStaff.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        email: s.email,
      })),
    };
  }

  async offboardUser(actorUserId: string, targetUserId: string, transferToUserId?: string) {
    const user = await this.userModel.findById(toValidObjectId(targetUserId)).exec();
    if (!user) throw new NotFoundException('Target user not found');

    if (transferToUserId) {
      const recipient = await this.userModel.findById(toValidObjectId(transferToUserId)).exec();
      if (!recipient || !recipient.isActive) {
        throw new BadRequestException('Transfer target user is invalid or inactive');
      }

      // Reassign all projects
      await this.projectModel.updateMany(
        {
          $or: [{ assignedTeamLeadId: user._id }, { createdBy: user._id }],
          deletedAt: { $exists: false },
        },
        { $set: { assignedTeamLeadId: recipient._id, createdBy: recipient._id } },
      );

      await this.audit.append({
        actorUserId,
        action: 'RESOURCE_OWNERSHIP_TRANSFERRED',
        resourceType: 'PROJECT',
        metadata: { fromUserId: targetUserId, toUserId: transferToUserId },
      });
    }

    // Invalidate active sessions
    await this.sessionModel.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );

    // Deactivate user
    user.isActive = false;
    await user.save();

    await this.audit.append({
      actorUserId,
      action: 'USER_OFFBOARDED',
      resourceType: 'USER',
      resourceId: user.id,
      metadata: { email: user.email, transferredTo: transferToUserId || 'NONE' },
    });

    return { success: true, message: `User ${user.email} has been successfully offboarded.` };
  }

  // ─── 3.14.3 Resource Ownership Transfer ───────────────────────────
  async transferResource(
    actorUserId: string,
    dto: { projectId: string; newAssigneeId: string; reason?: string },
  ) {
    const project = await this.projectModel.findById(toValidObjectId(dto.projectId)).exec();
    if (!project) throw new NotFoundException('Project not found');

    const newOwner = await this.userModel.findById(toValidObjectId(dto.newAssigneeId)).exec();
    if (!newOwner || !newOwner.isActive) {
      throw new BadRequestException('Target staff member is invalid or inactive');
    }

    const previousAssignee = project.assignedTeamLeadId?.toString() || project.createdBy.toString();
    project.assignedTeamLeadId = newOwner._id;
    await project.save();

    await this.audit.append({
      actorUserId,
      organizationId: project.organizationId.toString(),
      action: 'RESOURCE_OWNERSHIP_TRANSFERRED',
      resourceType: 'PROJECT',
      resourceId: project.id,
      metadata: {
        previousAssignee,
        newAssignee: dto.newAssigneeId,
        reason: dto.reason || '',
      },
    });

    return project;
  }

  // ─── 3.13.10 View Audit Logs ─────────────────────────────────────
  async listAuditLogs(query?: {
    page?: number;
    limit?: number;
    action?: string;
    resourceType?: string;
  }) {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.min(100, Math.max(1, query?.limit || 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<AuditLogDocument> = {};
    if (query?.action) filter.action = new RegExp(query.action, 'i');
    if (query?.resourceType) filter.resourceType = query.resourceType;

    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .populate('actorUserId', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.auditModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportAuditLogsCsv() {
    const logs = await this.auditModel
      .find()
      .populate('actorUserId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(1000)
      .exec();

    const headers = 'Timestamp,Actor,Action,ResourceType,ResourceId,Metadata\n';
    const rows = logs.map((l) => {
      const actor = l.actorUserId as unknown as { fullName?: string; email?: string } | undefined;
      const actorStr = actor?.fullName || actor?.email || String(l.actorUserId || 'SYSTEM');
      const metaStr = JSON.stringify(l.metadata || {}).replace(/"/g, '""');
      return `"${l.createdAt ? (l.createdAt as Date).toISOString() : ''}","${actorStr}","${l.action}","${l.resourceType}","${l.resourceId || ''}","${metaStr}"`;
    });

    return headers + rows.join('\n');
  }

  private async findOrgById(id: string) {
    let doc: OrganizationDocument | null = null;
    if (Types.ObjectId.isValid(id)) {
      doc = await this.orgModel.findById(id).exec();
    }
    if (!doc) {
      doc = await this.orgModel.findOne({ name: id }).exec();
    }
    if (!doc) {
      throw new NotFoundException(`Organisation '${id}' was not found`);
    }
    return doc;
  }
}
