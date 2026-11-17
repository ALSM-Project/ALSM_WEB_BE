import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  EmploymentStatus,
  MembershipStatus,
  OrganizationType,
  WorkforceMemberType,
} from '../../organizations/domain/organization.types';
import {
  Organization,
  OrganizationDocument,
} from '../../organizations/infrastructure/organization.schema';
import {
  OrganizationMembership,
  OrganizationMembershipDocument,
} from '../../organizations/infrastructure/organization-membership.schema';
import { Partner, PartnerDocument } from '../../partners/infrastructure/partner.schema';
import { Project, ProjectDocument } from '../../projects/infrastructure/project.schema';
import { RbacService } from '../../rbac/application/rbac.service';
import { Team } from '../../teams/infrastructure/team.schema';
import { User, UserDocument } from '../../users/infrastructure/user.schema';
import {
  SearchWorkforceQueryDto,
  WorkforceEmployeeDto,
  WorkforceSearchResponseDto,
} from '../presentation/workforce.dto';

const INTERNAL_ORG_NAME = 'ALSM Corporation (Internal Operations)';
const INTERNAL_ORG_DOMAIN = 'alsm.internal';

const INTERNAL_ROLES = new Set([
  'Platform Administrator',
  'System Admin',
  'Team Lead',
  'conversion staff',
  'Internal Sales',
  'Internal Support',
  'Sales Manager',
  'VP of Sales',
]);

@Injectable()
export class WorkforceService implements OnModuleInit {
  private readonly logger = new Logger(WorkforceService.name);
  private internalOrgId: Types.ObjectId | null = null;

  constructor(
    @InjectModel(OrganizationMembership.name)
    private readonly membershipModel: Model<OrganizationMembershipDocument>,
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<Team>,
    @InjectModel(Partner.name)
    private readonly partnerModel: Model<PartnerDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    private readonly rbacService: RbacService,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
  ) {}

  async onModuleInit() {
    try {
      await this.initializeInternalOrganizationAndMigrate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Workforce initialization failed: ${message}`);
    }
  }

  /**
   * Authoritative lookup for ALSM Internal Organization.
   */
  async getInternalOrganization(): Promise<OrganizationDocument> {
    if (this.internalOrgId) {
      const cached = await this.orgModel.findById(this.internalOrgId).exec();
      if (cached) return cached;
    }

    let internalOrg = await this.orgModel
      .findOne({
        $or: [
          { type: OrganizationType.INTERNAL },
          { domain: INTERNAL_ORG_DOMAIN },
          { name: INTERNAL_ORG_NAME },
        ],
      })
      .exec();

    if (!internalOrg) {
      this.logger.log('Creating ALSM Internal Organization...');
      internalOrg = await this.orgModel.create({
        name: INTERNAL_ORG_NAME,
        type: OrganizationType.INTERNAL,
        domain: INTERNAL_ORG_DOMAIN,
        contactEmail: 'admin@alsm.internal',
        status: 'ACTIVE',
        engagementType: 'ALSM Enterprise Modernization Operations',
        serviceMode: 'ALSM_MANAGED',
        members: [],
      });
    } else if (internalOrg.type !== OrganizationType.INTERNAL) {
      internalOrg.type = OrganizationType.INTERNAL;
      await internalOrg.save();
    }

    this.internalOrgId = internalOrg._id;
    return internalOrg;
  }

  /**
   * Initializes and backfills organization memberships without data loss.
   */
  async initializeInternalOrganizationAndMigrate() {
    const internalOrg = await this.getInternalOrganization();
    const existingCount = await this.membershipModel.countDocuments();

    this.logger.log(
      `Checking workforce migration: internalOrgId=${internalOrg.id}, existingMemberships=${existingCount}`,
    );

    const [allUsers, allPartners, allOrgs, allRoles] = await Promise.all([
      this.userModel.find().lean().exec(),
      this.partnerModel.find().lean().exec(),
      this.orgModel.find().lean().exec(),
      this.rbacService.getAllUsers().catch(() => []),
    ]);

    const userRolesMap = new Map<string, string[]>();
    for (const r of allRoles) {
      userRolesMap.set(r.id, r.roles || []);
    }

    const partnerEmails = new Set(
      allPartners
        .map((p) => p.contactEmail?.toLowerCase().trim())
        .filter(Boolean),
    );

    let createdCount = 0;

    for (const user of allUsers) {
      const uId = user._id.toString();
      const email = (user.email || '').toLowerCase().trim();
      const roles = userRolesMap.get(uId) || [];

      // Check if membership already exists for this user in any org
      const existing = await this.membershipModel.findOne({ userId: user._id }).exec();
      if (existing) {
        continue;
      }

      const hasInternalRole = roles.some((r) => INTERNAL_ROLES.has(r));
      const hasInternalEmail =
        email.endsWith('@alsm.internal') || email.endsWith('@alsm.dev');

      if (user.isPlatformAdmin || hasInternalRole || hasInternalEmail) {
        // INTERNAL WORKFORCE
        const codeNum = (createdCount + 1).toString().padStart(4, '0');
        await this.membershipModel.create({
          userId: user._id,
          organizationId: internalOrg._id,
          memberType: WorkforceMemberType.INTERNAL_EMPLOYEE,
          role: roles[0] || (user.isPlatformAdmin ? 'Platform Administrator' : 'Staff'),
          status: user.isActive ? MembershipStatus.ACTIVE : MembershipStatus.OFFBOARDED,
          employeeCode: `ALSM-EMP-${codeNum}`,
          department: hasInternalRole
            ? 'Conversion Operations'
            : user.isPlatformAdmin
            ? 'Executive & Administration'
            : 'Engineering',
          employmentStatus: user.isActive
            ? EmploymentStatus.ACTIVE
            : EmploymentStatus.OFFBOARDED,
          joinedAt: user.createdAt || new Date(),
        });
        createdCount++;
      } else if (partnerEmails.has(email) || roles.includes('Partner User')) {
        // PARTNER WORKFORCE
        const matchedPartner = allPartners.find(
          (p) => p.contactEmail?.toLowerCase().trim() === email,
        );
        const existingPartnerOrg = allOrgs.find(
          (o) =>
            o.contactEmail?.toLowerCase().trim() === email ||
            (matchedPartner && o.name === matchedPartner.name),
        );

        let partnerOrgId: Types.ObjectId;
        if (!existingPartnerOrg) {
          const createdOrg = await this.orgModel.create({
            name: matchedPartner ? matchedPartner.name : `${user.fullName || 'Partner'}'s Organization`,
            type: OrganizationType.PARTNER,
            domain: matchedPartner?.primaryDomain || 'partner.network',
            contactEmail: email,
            status: 'ACTIVE',
            members: [{ userId: user._id, role: 'OWNER' as unknown as any }],
          });
          partnerOrgId = createdOrg._id;
        } else {
          partnerOrgId = existingPartnerOrg._id as Types.ObjectId;
        }

        const codeNum = (createdCount + 1).toString().padStart(4, '0');
        await this.membershipModel.create({
          userId: user._id,
          organizationId: partnerOrgId,
          memberType: WorkforceMemberType.PARTNER_EMPLOYEE,
          role: 'Partner Representative',
          status: user.isActive ? MembershipStatus.ACTIVE : MembershipStatus.OFFBOARDED,
          employeeCode: `PTR-${codeNum}`,
          department: 'Partner Network Operations',
          employmentStatus: user.isActive
            ? EmploymentStatus.ACTIVE
            : EmploymentStatus.OFFBOARDED,
          joinedAt: user.createdAt || new Date(),
        });
        createdCount++;
      } else {
        // CUSTOMER MEMBER OR NEEDS REVIEW
        const customerOrg = allOrgs.find((o) =>
          o.members?.some((m) => m.userId?.toString() === uId),
        );

        if (customerOrg) {
          const codeNum = (createdCount + 1).toString().padStart(4, '0');
          await this.membershipModel.create({
            userId: user._id,
            organizationId: customerOrg._id,
            memberType: WorkforceMemberType.CUSTOMER_MEMBER,
            role: 'Client Member',
            status: user.isActive ? MembershipStatus.ACTIVE : MembershipStatus.OFFBOARDED,
            employeeCode: `CUST-${codeNum}`,
            department: 'Client Workspace',
            employmentStatus: user.isActive
              ? EmploymentStatus.ACTIVE
              : EmploymentStatus.OFFBOARDED,
            joinedAt: user.createdAt || new Date(),
          });
          createdCount++;
        } else {
          // Unclear affiliation -> Mark for review without guessing
          await this.membershipModel.create({
            userId: user._id,
            organizationId: internalOrg._id,
            memberType: WorkforceMemberType.CUSTOMER_MEMBER,
            role: 'Unassigned',
            status: MembershipStatus.NEEDS_REVIEW,
            employeeCode: `REV-${uId.slice(-4).toUpperCase()}`,
            department: 'Unassigned Review',
            employmentStatus: EmploymentStatus.ACTIVE,
            joinedAt: user.createdAt || new Date(),
            metadata: { note: 'Requires manual organization scoping confirmation' },
          });
          createdCount++;
        }
      }
    }

    this.logger.log(`Workforce migration complete. Seeded/verified ${createdCount} memberships.`);
  }

  /**
   * Search employees with strict portal and multi-tenant isolation.
   */
  async searchEmployees(
    actorUser: { userId: string; isPlatformAdmin?: boolean; organizationId?: string },
    query: SearchWorkforceQueryDto,
  ): Promise<WorkforceSearchResponseDto> {
    const internalOrg = await this.getInternalOrganization();
    const portal = query.portal || 'WEB2';
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const membershipFilter: Record<string, unknown> = {};

    // 1. Strict Tenant Boundary Enforcement
    if (portal === 'WEB2') {
      // WEB2 ADMIN: Strictly ALSM Internal Workforce
      membershipFilter.organizationId = internalOrg._id;
      membershipFilter.memberType = WorkforceMemberType.INTERNAL_EMPLOYEE;
    } else {
      // WEB3 PARTNER: Strictly the authenticated partner organization
      let targetOrgId = query.organizationId || actorUser.organizationId;
      if (!targetOrgId) {
        const actorMembership = await this.membershipModel
          .findOne({ userId: new Types.ObjectId(actorUser.userId) })
          .exec();
        targetOrgId = actorMembership?.organizationId?.toString();
      }

      if (!targetOrgId || targetOrgId === internalOrg.id) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED_PARTNER_SCOPE',
          message: 'Partner portal cannot access internal ALSM workforce',
        });
      }

      membershipFilter.organizationId = new Types.ObjectId(targetOrgId);
      membershipFilter.memberType = WorkforceMemberType.PARTNER_EMPLOYEE;
    }

    // 2. Status filter
    if (query.status && query.status !== 'ALL') {
      membershipFilter.status = query.status;
    } else if (!query.status) {
      membershipFilter.status = MembershipStatus.ACTIVE;
    }

    // 3. Member type filter override (only if compatible with portal scope)
    if (query.memberType && portal === 'WEB2' && query.memberType === WorkforceMemberType.INTERNAL_EMPLOYEE) {
      membershipFilter.memberType = WorkforceMemberType.INTERNAL_EMPLOYEE;
    }

    // 4. Autocomplete text search (name, email, code, department)
    const q = (query.q || '').trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m);
      const regex = new RegExp(escaped, 'i');

      // Search matching users first
      const matchedUsers = await this.userModel
        .find({
          $or: [{ fullName: regex }, { email: regex }],
        })
        .select('_id')
        .lean()
        .exec();

      const matchedUserIds = matchedUsers.map((u) => u._id);

      membershipFilter.$or = [
        { userId: { $in: matchedUserIds } },
        { employeeCode: regex },
        { department: regex },
        { role: regex },
      ];
    }

    const [total, memberships] = await Promise.all([
      this.membershipModel.countDocuments(membershipFilter),
      this.membershipModel
        .find(membershipFilter)
        .sort({ status: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId')
        .populate('organizationId')
        .lean()
        .exec(),
    ]);

    // Active project workloads
    const targetUserIds = memberships.map((m) => m.userId?._id || m.userId);
    const activeProjects = await this.projectModel
      .find({
        assignedStaffId: { $in: targetUserIds },
        isExported: false,
      })
      .select('assignedStaffId')
      .lean()
      .exec();

    const workloadMap = new Map<string, number>();
    for (const p of activeProjects) {
      if (p.assignedStaffId) {
        const idStr = p.assignedStaffId.toString();
        workloadMap.set(idStr, (workloadMap.get(idStr) || 0) + 1);
      }
    }

    // Fetch roles
    const allUserRoles = await this.rbacService.getAllUsers().catch(() => []);
    const roleMap = new Map<string, string[]>();
    for (const r of allUserRoles) {
      roleMap.set(r.id, r.roles || []);
    }

    const items: WorkforceEmployeeDto[] = memberships.map((m: any) => {
      const u = m.userId || {};
      const org = m.organizationId || {};
      const uId = (u._id || m.userId).toString();
      const workload = workloadMap.get(uId) || 0;
      const roles = roleMap.get(uId) || (m.role ? [m.role] : ['Staff']);

      return {
        id: m._id.toString(),
        membershipId: m._id.toString(),
        userId: uId,
        fullName: u.fullName || u.email || 'Employee',
        email: u.email || '',
        employeeCode: m.employeeCode || `EMP-${uId.slice(-6).toUpperCase()}`,
        department: m.department || 'Operations',
        teamId: m.teamId?.toString(),
        teamName: m.teamName || 'Conversion Operations',
        role: m.role || roles[0] || 'Staff',
        memberType: m.memberType,
        status: m.status,
        employmentStatus: m.employmentStatus,
        organizationId: (org._id || m.organizationId).toString(),
        organizationName: org.name || 'ALSM Internal',
        activeWorkload: workload,
        maxCapacity: 5,
        roles,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Helper to retrieve all active ALSM internal employees for internal services.
   */
  async getInternalEmployees(): Promise<WorkforceEmployeeDto[]> {
    const res = await this.searchEmployees(
      { userId: '000000000000000000000000', isPlatformAdmin: true },
      { portal: 'WEB2', status: MembershipStatus.ACTIVE, limit: 20 },
    );
    return res.items;
  }

  /**
   * Validates that a user is an active ALSM internal employee.
   */
  async validateInternalEmployee(userId: string): Promise<OrganizationMembershipDocument> {
    const internalOrg = await this.getInternalOrganization();
    const membership = await this.membershipModel
      .findOne({
        userId: new Types.ObjectId(userId),
        organizationId: internalOrg._id,
        memberType: WorkforceMemberType.INTERNAL_EMPLOYEE,
        status: MembershipStatus.ACTIVE,
      })
      .exec();

    if (!membership) {
      throw new BadRequestException({
        code: 'NOT_INTERNAL_EMPLOYEE',
        message: 'Selected user is not an active ALSM internal employee',
      });
    }

    return membership;
  }

  /**
   * Offboards an internal employee from ALSM without destroying partner or other valid memberships.
   */
  async offboardInternalEmployee(
    actorUserId: string,
    targetUserId: string,
    reason?: string,
  ): Promise<{ internalMembershipOffboarded: boolean; globalUserDeactivated: boolean }> {
    const internalOrg = await this.getInternalOrganization();
    const membership = await this.membershipModel
      .findOne({
        userId: new Types.ObjectId(targetUserId),
        organizationId: internalOrg._id,
        memberType: WorkforceMemberType.INTERNAL_EMPLOYEE,
      })
      .exec();

    if (membership) {
      membership.status = MembershipStatus.OFFBOARDED;
      membership.employmentStatus = EmploymentStatus.OFFBOARDED;
      membership.endedAt = new Date();
      membership.metadata = {
        ...(membership.metadata || {}),
        offboardedBy: actorUserId,
        offboardReason: reason || 'Staff offboarding executed',
        offboardedAt: new Date().toISOString(),
      };
      await membership.save();
    }

    // Check if the user has other active memberships in any other organization (e.g. Partner, Client)
    const otherActiveMemberships = await this.membershipModel
      .countDocuments({
        userId: new Types.ObjectId(targetUserId),
        organizationId: { $ne: internalOrg._id },
        status: MembershipStatus.ACTIVE,
      })
      .exec();

    let globalUserDeactivated = false;
    const targetUser = await this.userModel.findById(new Types.ObjectId(targetUserId)).exec();

    if (targetUser) {
      if (otherActiveMemberships > 0) {
        // User still possesses active memberships in another portal -> DO NOT LOCK globally
        this.logger.log(
          `User ${targetUser.email} has ${otherActiveMemberships} other active memberships. Preserving global user account.`,
        );
      } else {
        // No other memberships -> Deactivate global account
        targetUser.isActive = false;
        targetUser.isLocked = true;
        targetUser.lockReason = reason || 'Internal employee offboarded';
        targetUser.lockedAt = new Date();
        targetUser.lockedBy = actorUserId;
        await targetUser.save();
        globalUserDeactivated = true;
      }
    }

    await this.audit.append({
      actorUserId,
      action: 'INTERNAL_WORKFORCE_OFFBOARDED',
      resourceType: 'WORKFORCE_MEMBERSHIP',
      resourceId: membership?.id || targetUserId,
      metadata: {
        targetUserId,
        reason: reason || 'Offboarding completed',
        otherActiveMembershipsCount: otherActiveMemberships.toString(),
        globalUserDeactivated: globalUserDeactivated ? 'true' : 'false',
      },
    });

    return {
      internalMembershipOffboarded: true,
      globalUserDeactivated,
    };
  }
}
