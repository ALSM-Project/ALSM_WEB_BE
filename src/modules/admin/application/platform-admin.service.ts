import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
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
import { MongoTransactionRunner } from '../../../shared/database/mongo-transaction-runner';
import { OrganizationEngagementLimitsDto } from '../presentation/dto/update-organization-engagement.dto';
import { CreateEnterpriseOrganizationDto } from '../presentation/dto/create-enterprise-organization.dto';
import { PasswordReset, PasswordResetDocument } from '../../auth/infrastructure/password-reset.schema';
import { Role, RoleDocument } from '../../rbac/infrastructure/schemas/role.schema';
import { UserRole, UserRoleDocument } from '../../rbac/infrastructure/schemas/user-role.schema';
import { EMAIL_PORT, EmailPort } from '../../auth/domain/email.port';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { CreateEngagementTypeDto } from '../presentation/dto/create-engagement-type.dto';

type TransactionAwareAuditRepository = AuditRepository & {
  inTransaction(session: ClientSession, connection: Connection): AuditRepository;
};

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

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
    @Optional() @InjectModel(PasswordReset.name) private readonly passwordResetModel?: Model<PasswordResetDocument>,
    @Optional() @InjectModel(Role.name) private readonly roleModel?: Model<RoleDocument>,
    @Optional() @InjectModel(UserRole.name) private readonly userRoleModel?: Model<UserRoleDocument>,
    @Optional() @Inject(EMAIL_PORT) private readonly email?: EmailPort,
  ) {}

  // ─── 3.13.1 View All Organisations ──────────────────────────────
  async listOrganizations(query?: { search?: string; type?: string; status?: string }) {
    try {
      const filter: FilterQuery<OrganizationDocument> = {};
      if (query?.type && query.type !== 'ALL') filter.type = query.type;
      if (query?.status && query.status !== 'ALL') filter.status = query.status;
      const search = query?.search?.trim();
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escaped, 'i');
        filter.$or = [{ name: searchRegex }, { domain: searchRegex }, { contactEmail: searchRegex }];
      }

      const orgs = await this.orgModel
        .find(filter)
        .select('name type status domain contactEmail engagementType members limits trialExpiresAt createdAt updatedAt')
        .sort({ createdAt: -1, _id: -1 })
        .exec();
      if (!orgs.length) return [];

      const organizationIds = orgs.map((org) => org._id);
      const projectCounts = await this.projectModel.aggregate([
        {
          $match: {
            organizationId: { $in: organizationIds },
            deletedAt: { $exists: false },
          },
        },
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
      ]).exec();
      const projectCountByOrganization = new Map(
        projectCounts.map((entry: { _id: Types.ObjectId | string; count: number }) => [String(entry._id), entry.count]),
      );

      return orgs.map((org) => ({
        id: org.id || org._id.toString(),
        name: org.name,
        type: org.type,
        status: org.status || 'ACTIVE',
        domain: org.domain,
        contactEmail: org.contactEmail,
        engagementType: org.engagementType || 'Trial',
        memberCount: (org.members || []).length,
        projectCount: projectCountByOrganization.get(org._id.toString()) ?? 0,
        limits: org.limits,
        trialExpiresAt: org.trialExpiresAt,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      }));
    } catch (error) {
      this.logger.error(
        'Failed to load platform organisation directory',
        error instanceof Error ? error.name : 'unknown error',
      );
      throw new ServiceUnavailableException({
        code: 'ORGANIZATION_LIST_UNAVAILABLE',
        message: 'Organisations are temporarily unavailable. Please retry.',
      });
    }
  }

  // ─── 3.13.2 View Organisation Details ───────────────────────────
  async getOrganizationDetails(id: string) {
    if (!id || !id.trim()) {
      throw new BadRequestException('Organization ID cannot be empty');
    }
    const org = await this.findOrgById(id.trim());
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

    // Populate projects list
    const projects = await this.projectModel
      .find({
        organizationId: { $in: [orgObjId, id] },
        deletedAt: { $exists: false },
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .exec();

    const populatedProjects = projects.map((p) => ({
      id: p.id || p._id.toString(),
      name: p.name,
      conversionType: p.conversionType,
      status: p.status,
      isDemo: Boolean(p.isDemo),
      createdAt: p.createdAt,
    }));

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
      usageStats: {
        totalScreensConverted: jobCount,
        activeProjects: projectCount,
        storageUsedGb: 0,
        conversionsThisMonth: jobCount,
      },
      projects: populatedProjects,
      members: populatedMembers,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  // ─── 3.13.4 Create New Enterprise Organisation ───────────────────
  async createEnterpriseOrganization(
    actorUserId: string,
    dto: CreateEnterpriseOrganizationDto,
  ) {
    if (!Types.ObjectId.isValid(actorUserId)) {
      throw new BadRequestException({ code: 'INVALID_ACTOR_ID', message: 'A valid administrator is required.' });
    }
    if (!this.passwordResetModel || !this.roleModel || !this.userRoleModel || !this.email) {
      throw new ServiceUnavailableException({ code: 'ORGANIZATION_PROVISIONING_UNAVAILABLE', message: 'Organisation provisioning is temporarily unavailable.' });
    }
    const name = dto.name.trim().replace(/\s+/g, ' ');
    const normalizedName = name.toLocaleLowerCase('en-US');
    const contactEmail = dto.contactEmail.trim().toLowerCase();
    const engagementType = dto.engagementType.trim();
    const domain = dto.domain?.trim().toLowerCase() || undefined;
    const requestId = dto.requestId || randomUUID();
    const fingerprint = createHash('sha256').update(JSON.stringify({
      name, normalizedName, contactEmail, engagementType, domain,
      trialDays: dto.trialDays ?? null, maxScreens: dto.maxScreens ?? null,
      maxPrograms: dto.maxPrograms ?? null, maxStorageGb: dto.maxStorageGb ?? null,
    })).digest('hex');
    const findByRequestId = async () => this.orgModel.findOne({ provisioningRequestId: requestId }).exec();
    const prior = await findByRequestId();
    if (prior) {
      if (prior.provisioningFingerprint !== fingerprint) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request identifier was already used for different organisation details.' });
      }
      return { organization: await this.getOrganizationDetails(prior.id), invitationStatus: prior.initialAdminInviteStatus, replayed: true };
    }

    let createdOrgId = '';
    let inviteToken: string | undefined;
    let inviteEmail: string | undefined;
    let shouldSendInvite = false;
    let replayed = false;
    let replayInvitationStatus: 'PENDING' | 'SENT' | 'FAILED' | 'NOT_REQUIRED' = 'NOT_REQUIRED';
    try {
      const transactionRunner = new MongoTransactionRunner(this.orgModel.db);
      await transactionRunner.run(async (session) => {
        const duplicateRequest = await this.orgModel.findOne({ provisioningRequestId: requestId }).session(session).exec();
        if (duplicateRequest) {
          if (duplicateRequest.provisioningFingerprint !== fingerprint) {
            throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request identifier was already used for different organisation details.' });
          }
          createdOrgId = duplicateRequest.id;
          replayed = true;
          replayInvitationStatus = duplicateRequest.initialAdminInviteStatus;
          return;
        }
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const duplicateName = await this.orgModel.findOne({
          $or: [{ normalizedName }, { name: new RegExp(`^${escapedName}$`, 'i') }],
        }).session(session).exec();
        if (duplicateName) {
          throw new ConflictException({ code: 'ORGANIZATION_NAME_EXISTS', message: 'An organisation with this name already exists.' });
        }
        const engagement = await this.engagementModel.findOne({ name: engagementType, isActive: true }).session(session).exec();
        if (!engagement) {
          throw new BadRequestException({ code: 'ENGAGEMENT_TYPE_NOT_FOUND', message: 'Select an active engagement type.' });
        }
        const role = await this.roleModel!.findOne({ id: 'ENTERPRISE_MEMBER' }).session(session).exec();
        if (!role) {
          throw new ServiceUnavailableException({ code: 'ORGANIZATION_ROLE_UNAVAILABLE', message: 'Organisation access cannot be provisioned right now.' });
        }

        let contactUser = await this.userModel.findOne({ email: contactEmail }).session(session).exec();
        if (contactUser && (!contactUser.isActive || contactUser.isLocked || contactUser.isPlatformAdmin)) {
          throw new ConflictException({ code: 'CONTACT_USER_UNAVAILABLE', message: 'This email address cannot be assigned as the organisation administrator.' });
        }
        if (!contactUser) {
          const [createdUser] = await this.userModel.create([{
            email: contactEmail,
            fullName: `${name} Admin`,
            isActive: true,
            isPlatformAdmin: false,
            isEmailVerified: false,
            mustChangePassword: true,
          }], { session });
          contactUser = createdUser;
        }

        await this.userRoleModel!.updateOne(
          { userId: contactUser._id.toString(), roleId: 'ENTERPRISE_MEMBER' },
          { $setOnInsert: { userId: contactUser._id.toString(), roleId: 'ENTERPRISE_MEMBER' } },
          { upsert: true, session },
        ).exec();

        const hasAccount = Boolean(contactUser.isEmailVerified);
        if (!hasAccount) {
          inviteToken = randomBytes(32).toString('hex');
          inviteEmail = contactEmail;
          shouldSendInvite = true;
          await this.passwordResetModel!.create([{
            userId: contactUser._id,
            tokenHash: createHash('sha256').update(inviteToken).digest('hex'),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }], { session });
        }

        const now = new Date();
        const limits = {
          ...(engagement.trialLimits || {}),
          ...(dto.maxScreens !== undefined ? { maxScreens: dto.maxScreens } : {}),
          ...(dto.maxPrograms !== undefined ? { maxPrograms: dto.maxPrograms } : {}),
          ...(dto.maxStorageGb !== undefined ? { maxStorageGb: dto.maxStorageGb } : {}),
        };
        const [org] = await this.orgModel.create([{
          name,
          normalizedName,
          type: OrganizationType.ENTERPRISE,
          domain,
          contactEmail,
          status: 'TRIAL',
          engagementType,
          trialExpiresAt: new Date(now.getTime() + (dto.trialDays ?? 30) * 86400 * 1000),
          limits,
          members: [{ userId: contactUser._id, role: OrganizationRole.ADMIN }],
          provisioningRequestId: requestId,
          provisioningFingerprint: fingerprint,
          initialAdminInviteStatus: shouldSendInvite ? 'PENDING' : 'NOT_REQUIRED',
        }], { session });
        createdOrgId = org.id;
        const transactionAudit = (this.audit as TransactionAwareAuditRepository).inTransaction(session, this.orgModel.db);
        await transactionAudit.append({
          actorUserId,
          organizationId: org._id.toString(),
          action: 'ENTERPRISE_ORGANIZATION_CREATED',
          resourceType: 'ORGANIZATION',
          resourceId: org._id.toString(),
          metadata: { name, contactEmail, engagementType, initialAdminInviteRequired: String(shouldSendInvite) },
        });
      }, requestId);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      if (error instanceof ServiceUnavailableException) {
        const concurrent = await findByRequestId();
        if (concurrent?.provisioningFingerprint === fingerprint) {
          return { organization: await this.getOrganizationDetails(concurrent.id), invitationStatus: concurrent.initialAdminInviteStatus, replayed: true };
        }
        const duplicateName = await this.orgModel.findOne({
          $or: [{ normalizedName }, { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
        }).exec();
        if (duplicateName) {
          throw new ConflictException({ code: 'ORGANIZATION_NAME_EXISTS', message: 'An organisation with this name already exists.' });
        }
        throw error;
      }
      if ((error as { code?: number })?.code === 11000) {
        const concurrent = await findByRequestId();
        if (concurrent?.provisioningFingerprint === fingerprint) {
          return { organization: await this.getOrganizationDetails(concurrent.id), invitationStatus: concurrent.initialAdminInviteStatus, replayed: true };
        }
        throw new ConflictException({ code: 'ORGANIZATION_ALREADY_EXISTS', message: 'An organisation with these details already exists.' });
      }
      this.logger.error('Enterprise organisation provisioning failed', error instanceof Error ? error.name : 'unknown error');
      throw new ServiceUnavailableException({ code: 'ORGANIZATION_PROVISIONING_FAILED', message: 'The organisation could not be created. Please retry.' });
    }

    if (!createdOrgId) throw new ServiceUnavailableException({ code: 'ORGANIZATION_PROVISIONING_FAILED', message: 'The organisation could not be created. Please retry.' });
    if (replayed) {
      return { organization: await this.getOrganizationDetails(createdOrgId), invitationStatus: replayInvitationStatus, replayed: true };
    }
    let invitationStatus: 'PENDING' | 'SENT' | 'FAILED' | 'NOT_REQUIRED' = shouldSendInvite ? 'PENDING' : 'NOT_REQUIRED';
    if (shouldSendInvite && inviteToken && inviteEmail) {
      try {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
          throw new Error('SMTP is not configured');
        }
        const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
        const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(inviteToken)}`;
        await this.email!.send({
          to: inviteEmail,
          subject: 'Set up your ALSM organisation administrator account',
          text: `An administrator created your organisation account. Set your password using this secure link: ${setupUrl}`,
          html: `<p>An administrator created your organisation account.</p><p><a href="${setupUrl}">Set your password</a>. This link expires in 7 days.</p>`,
        });
        invitationStatus = 'SENT';
      } catch (error) {
        this.logger.warn(`Initial organisation admin invite failed (${error instanceof Error ? error.name : 'unknown error'})`);
        invitationStatus = 'FAILED';
      }
      try {
        await this.orgModel.updateOne({ _id: new Types.ObjectId(createdOrgId) }, { $set: { initialAdminInviteStatus: invitationStatus } }).exec();
      } catch (error) {
        this.logger.warn(`Initial organisation invite status update failed (${error instanceof Error ? error.name : 'unknown error'})`);
        invitationStatus = 'PENDING';
      }
    }
    return {
      organization: await this.getOrganizationDetails(createdOrgId),
      invitationStatus,
      replayed: false,
    };
  }

  // ─── 3.13.5 Update Organisation Engagement ───────────────────────
  async updateOrganizationEngagement(
    actorUserId: string,
    id: string,
    dto: {
      engagementType?: string;
      status?: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
      trialExpiresAt?: string;
      limits?: OrganizationEngagementLimitsDto;
    },
  ) {
    if (!Types.ObjectId.isValid(actorUserId)) {
      throw new BadRequestException({ code: 'INVALID_ACTOR_ID', message: 'A valid administrator is required.' });
    }
    if (!Types.ObjectId.isValid(id || '')) {
      throw new BadRequestException({ code: 'INVALID_ORGANIZATION_ID', message: 'The organisation identifier is invalid.' });
    }

    const engagementType = dto.engagementType?.trim();
    if (dto.engagementType !== undefined && (!engagementType || engagementType.length > 100)) {
      throw new BadRequestException({ code: 'INVALID_ENGAGEMENT_TYPE', message: 'Select a valid engagement type.' });
    }
    if (dto.status !== undefined && !['ACTIVE', 'SUSPENDED', 'TRIAL'].includes(dto.status)) {
      throw new BadRequestException({ code: 'INVALID_ORGANIZATION_STATUS', message: 'Select a valid organisation status.' });
    }
    if (dto.trialExpiresAt !== undefined && Number.isNaN(Date.parse(dto.trialExpiresAt))) {
      throw new BadRequestException({ code: 'INVALID_TRIAL_EXPIRY', message: 'Enter a valid trial expiry date.' });
    }
    const allowedLimitKeys = new Set([
      'maxProjects', 'maxConversionsPerMonth', 'maxStorageGb', 'aiValidationEnabled',
      'trialScreens', 'trialPrograms', 'trialStorageGb',
    ]);
    const limitEntries = Object.entries(dto.limits ?? {});
    if (Object.keys(dto).length === 0 || dto.limits === null || (dto.limits && limitEntries.length === 0)) {
      throw new BadRequestException({ code: 'EMPTY_ENGAGEMENT_UPDATE', message: 'Change at least one engagement setting.' });
    }
    for (const [key, value] of limitEntries) {
      if (!allowedLimitKeys.has(key)) {
        throw new BadRequestException({ code: 'INVALID_ENGAGEMENT_LIMIT', message: 'The submitted engagement limit is not supported.' });
      }
      if (key === 'aiValidationEnabled') {
        if (typeof value !== 'boolean') {
          throw new BadRequestException({ code: 'INVALID_ENGAGEMENT_LIMIT', message: 'AI validation must be enabled or disabled.' });
        }
        continue;
      }
      const isStorage = key === 'maxStorageGb' || key === 'trialStorageGb';
      if (typeof value !== 'number' || !Number.isFinite(value) || value < (isStorage ? 0.1 : 1) ||
        value > 1_000_000 || (!isStorage && !Number.isInteger(value))) {
        throw new BadRequestException({ code: 'INVALID_ENGAGEMENT_LIMIT', message: 'Limits must be positive values within the supported range.' });
      }
    }

    const transactionRunner = new MongoTransactionRunner(this.orgModel.db);
    await transactionRunner.run(async (session) => {
      const org = await this.orgModel
        .findById(new Types.ObjectId(id))
        .session(session)
        .exec();
      if (!org) throw new NotFoundException({ code: 'ORGANIZATION_NOT_FOUND', message: 'The organisation was not found.' });

      const previous = {
        status: org.status,
        engagementType: org.engagementType,
        trialExpiresAt: org.trialExpiresAt?.toISOString(),
        limits: JSON.stringify(org.limits ?? {}),
      };
      if (dto.status !== undefined) org.status = dto.status;
      if (engagementType !== undefined) org.engagementType = engagementType;
      if (dto.trialExpiresAt !== undefined) org.trialExpiresAt = new Date(dto.trialExpiresAt);
      if (dto.limits) org.limits = { ...org.limits, ...dto.limits };

      const changedFields = [
        previous.status !== org.status ? 'status' : undefined,
        previous.engagementType !== org.engagementType ? 'engagementType' : undefined,
        previous.trialExpiresAt !== org.trialExpiresAt?.toISOString() ? 'trialExpiresAt' : undefined,
        previous.limits !== JSON.stringify(org.limits ?? {}) ? 'limits' : undefined,
      ].filter((field): field is string => Boolean(field));
      if (changedFields.length === 0) return;

      await org.save({ session });
      const transactionAudit = (this.audit as TransactionAwareAuditRepository).inTransaction(
        session,
        this.orgModel.db,
      );
      await transactionAudit.append({
        actorUserId,
        organizationId: org._id.toString(),
        action: 'ORGANISATION_ENGAGEMENT_UPDATED',
        resourceType: 'ORGANIZATION',
        resourceId: org._id.toString(),
        metadata: {
          changedFields: changedFields.join(','),
          engagementType: org.engagementType,
          status: org.status,
        },
      });
    }, id);

    return this.getOrganizationDetails(id);
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
      currency: 'VND',
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
    return list.map((item) => this.toEngagementTypeResponse(item));
  }

  async createEngagementType(actorUserId: string, dto: CreateEngagementTypeDto) {
    if (!Types.ObjectId.isValid(actorUserId)) {
      throw new BadRequestException({ code: 'INVALID_ACTOR_ID', message: 'A valid platform administrator is required.' });
    }
    const name = dto.name.trim().replace(/\s+/g, ' ');
    const normalizedName = name.toLowerCase();
    const code = (dto.code?.trim().toUpperCase() || this.generateEngagementCode(name));
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) {
      throw new BadRequestException({ code: 'INVALID_ENGAGEMENT_CODE', message: 'Enter a plan code using 2–50 letters, numbers, or underscores; it must start with a letter.' });
    }
    const requestId = dto.requestId || randomUUID();
    const data = {
      name,
      normalizedName,
      code,
      description: dto.description?.trim() || undefined,
      price: dto.price,
      trialLimits: dto.trialLimits,
      usageLimits: dto.usageLimits,
      features: dto.features?.map((feature) => feature.trim()).filter(Boolean) || [],
      includesCobolConversion: dto.includesCobolConversion ?? false,
      supportTier: dto.supportTier || (dto.price > 25_000 ? 'PREMIER' : 'STANDARD'),
      slaHours: dto.slaHours ?? (dto.price > 25_000 ? 4 : 12),
      isActive: true,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const findRequest = () => this.engagementModel
      .findOne({ provisioningRequestId: requestId })
      .select('+provisioningRequestId +provisioningFingerprint')
      .exec();
    const prior = await findRequest();
    if (prior) {
      if (prior.provisioningFingerprint !== fingerprint) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request identifier was already used for different engagement type details.' });
      }
      return { engagementType: this.toEngagementTypeResponse(prior), replayed: true };
    }

    let created: EngagementTypeDocument | null = null;
    let replayed = false;
    try {
      const transactionRunner = new MongoTransactionRunner(this.engagementModel.db);
      await transactionRunner.run(async (session) => {
        const requestMatch = await this.engagementModel
          .findOne({ provisioningRequestId: requestId })
          .select('+provisioningRequestId +provisioningFingerprint')
          .session(session)
          .exec();
        if (requestMatch) {
          if (requestMatch.provisioningFingerprint !== fingerprint) {
            throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request identifier was already used for different engagement type details.' });
          }
          created = requestMatch;
          replayed = true;
          return;
        }

        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingName = await this.engagementModel.findOne({
          $or: [{ normalizedName }, { name: new RegExp(`^${escapedName}$`, 'i') }],
        }).session(session).exec();
        if (existingName) {
          throw new ConflictException({ code: 'ENGAGEMENT_TYPE_NAME_EXISTS', message: 'An engagement type with this name already exists.' });
        }
        const existingCode = await this.engagementModel.findOne({ code }).session(session).exec();
        const legacyCodeMatch = existingCode ? null : (await this.engagementModel
          .find({ code: { $exists: false } })
          .session(session)
          .exec())
          .find((item) => this.generateEngagementCode(item.name) === code);
        if (existingCode || legacyCodeMatch) {
          throw new ConflictException({ code: 'ENGAGEMENT_TYPE_CODE_EXISTS', message: 'An engagement type with this code already exists.' });
        }

        const [createdRecord] = await this.engagementModel.create([{
          ...data,
          provisioningRequestId: requestId,
          provisioningFingerprint: fingerprint,
        }], { session });
        created = createdRecord;
        const transactionAudit = (this.audit as TransactionAwareAuditRepository).inTransaction(session, this.engagementModel.db);
        await transactionAudit.append({
          actorUserId,
          action: 'ENGAGEMENT_TYPE_CREATED',
          resourceType: 'ENGAGEMENT_TYPE',
          resourceId: createdRecord._id.toString(),
          metadata: { name, code, price: String(data.price), supportTier: data.supportTier },
        });
      }, requestId);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      if (error instanceof ServiceUnavailableException) {
        const concurrent = await findRequest();
        if (concurrent?.provisioningFingerprint === fingerprint) {
          return { engagementType: this.toEngagementTypeResponse(concurrent), replayed: true };
        }
        const [nameMatch, codeMatch] = await Promise.all([
          this.engagementModel.findOne({ $or: [{ normalizedName }, { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] }).exec(),
          this.engagementModel.findOne({ code }).exec(),
        ]);
        if (nameMatch) throw new ConflictException({ code: 'ENGAGEMENT_TYPE_NAME_EXISTS', message: 'An engagement type with this name already exists.' });
        if (codeMatch) throw new ConflictException({ code: 'ENGAGEMENT_TYPE_CODE_EXISTS', message: 'An engagement type with this code already exists.' });
        throw error;
      }
      if ((error as { code?: number })?.code === 11000) {
        const concurrent = await findRequest();
        if (concurrent?.provisioningFingerprint === fingerprint) {
          return { engagementType: this.toEngagementTypeResponse(concurrent), replayed: true };
        }
        throw new ConflictException({ code: 'ENGAGEMENT_TYPE_ALREADY_EXISTS', message: 'This engagement type conflicts with an existing name or code.' });
      }
      this.logger.error('Engagement type creation failed', error instanceof Error ? error.name : 'unknown error');
      throw new ServiceUnavailableException({ code: 'ENGAGEMENT_TYPE_CREATE_FAILED', message: 'The engagement type could not be created. Please retry.' });
    }
    if (!created) {
      throw new ServiceUnavailableException({ code: 'ENGAGEMENT_TYPE_CREATE_FAILED', message: 'The engagement type could not be created. Please retry.' });
    }
    return { engagementType: this.toEngagementTypeResponse(created), replayed };
  }

  private generateEngagementCode(name: string): string {
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45);
    const code = /^[A-Z]/.test(base) ? base : `PLAN_${base}`;
    return code.length >= 2 ? code : 'PLAN_TYPE';
  }

  private toEngagementTypeResponse(item: EngagementTypeDocument) {
    const value = (item.toObject ? item.toObject() : item) as typeof item & { id?: string };
    const name = value.name;
    const code = value.code || this.generateEngagementCode(name);
    return {
      id: item._id?.toString?.() || (value as unknown as { id?: string }).id || '',
      name,
      code,
      description: value.description || '',
      price: value.price ?? 0,
      trialLimits: value.trialLimits,
      usageLimits: value.usageLimits,
      features: value.features || [],
      includesCobolConversion: value.includesCobolConversion ?? false,
      supportTier: value.supportTier || 'STANDARD',
      slaHours: value.slaHours ?? 12,
      isActive: value.isActive ?? true,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
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
  // Moved to AuditLogService (dedicated read/export of the immutable trail).

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
