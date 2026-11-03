import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import { RbacService } from '../../rbac/application/rbac.service';
import { Team } from '../../teams/infrastructure/team.schema';
import { User, UserDocument } from '../infrastructure/user.schema';
import {
  IOffboardingRequestRepository,
  OFFBOARDING_REQUEST_REPOSITORY,
  OffboardingRequestRecord,
  OffboardingRequestStatus,
} from '../domain/offboarding-request.types';
import {
  UserOffboardingResult,
  UserOffboardingSummary,
} from '../domain/user-offboarding.types';
import {
  ApproveOffboardingRequestDto,
  CreateOffboardingRequestDto,
  ListOffboardingRequestsQueryDto,
  RejectOffboardingRequestDto,
} from '../presentation/offboarding-request.dto';
import { ProjectTransferItemDto as OffboardingProjectTransferItemDto } from '../presentation/user-offboarding.dto';
import { UserOffboardingService } from './user-offboarding.service';

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`Invalid ID: ${id}`);
  }
  return new Types.ObjectId(id);
}

@Injectable()
export class UserOffboardingApprovalService {
  constructor(
    @Inject(OFFBOARDING_REQUEST_REPOSITORY)
    private readonly requestRepo: IOffboardingRequestRepository,
    private readonly offboardingService: UserOffboardingService,
    private readonly rbacService: RbacService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Team.name)
    private readonly teamModel: Model<Team>,
    @Inject(AUDIT_REPOSITORY)
    private readonly audit: AuditRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * UC-89: Create a new user offboarding request for Team Lead approval.
   */
  async createRequest(
    actorUserId: string,
    dto: CreateOffboardingRequestDto,
    isPlatformAdmin = false,
  ): Promise<OffboardingRequestRecord> {
    if (actorUserId === dto.targetUserId) {
      throw new BadRequestException({
        code: 'CANNOT_OFFBOARD_SELF',
        message: 'You cannot request offboarding for your own account',
      });
    }

    const actorOid = toObjectId(actorUserId);
    const targetOid = toObjectId(dto.targetUserId);

    const [actorUser, targetUser] = await Promise.all([
      this.userModel.findById(actorOid).lean().exec(),
      this.userModel.findById(targetOid).lean().exec(),
    ]);

    if (!actorUser) {
      throw new NotFoundException({
        code: 'ACTOR_NOT_FOUND',
        message: 'Current authenticated user was not found',
      });
    }

    if (!targetUser) {
      throw new NotFoundException({
        code: 'TARGET_USER_NOT_FOUND',
        message: 'Target staff member was not found',
      });
    }

    if (targetUser.isActive === false) {
      throw new BadRequestException({
        code: 'USER_ALREADY_OFFBOARDED',
        message: 'Target staff member is already offboarded or inactive',
      });
    }

    if (targetUser.isPlatformAdmin && !isPlatformAdmin) {
      throw new ForbiddenException({
        code: 'CANNOT_OFFBOARD_PLATFORM_ADMIN',
        message: 'Cannot request offboarding for a Platform Administrator',
      });
    }

    // Check if there is already an active pending request for this user
    const existingPending = await this.requestRepo.findPendingByTargetUser(dto.targetUserId);
    if (existingPending) {
      throw new BadRequestException({
        code: 'OFFBOARDING_REQUEST_ALREADY_PENDING',
        message: `An offboarding request is already pending for ${targetUser.email}`,
      });
    }

    // Locate target user's team membership and verify Team Lead scope
    const teams = await this.teamModel
      .find({ memberIds: dto.targetUserId })
      .lean()
      .exec();

    const targetTeam = teams[0];

    if (!isPlatformAdmin) {
      // Validate that the actor is authorized (e.g. manager/lead of target's team)
      const managedTeams = await this.teamModel
        .find({ managerIds: actorUserId })
        .lean()
        .exec();

      const canManageTarget = managedTeams.some((t) =>
        t.memberIds.includes(dto.targetUserId),
      );

      if (!canManageTarget) {
        throw new ForbiddenException({
          code: 'UNAUTHORIZED_TEAM_LEAD_SCOPE',
          message:
            'You can only submit offboarding requests for staff members in teams you manage',
        });
      }
    }

    // Validate proposed successor if specified
    let successorUser: { fullName?: string; email: string; isActive?: boolean } | null = null;
    if (dto.transferToUserId) {
      if (dto.transferToUserId === dto.targetUserId) {
        throw new BadRequestException({
          code: 'INVALID_SUCCESSOR',
          message: 'The proposed successor cannot be the user being offboarded',
        });
      }
      const sOid = toObjectId(dto.transferToUserId);
      const foundSuccessor = await this.userModel.findById(sOid).lean().exec();
      if (!foundSuccessor || foundSuccessor.isActive === false) {
        throw new BadRequestException({
          code: 'INVALID_SUCCESSOR',
          message: 'The proposed successor does not exist or is inactive',
        });
      }
      successorUser = foundSuccessor;
    }

    // Retrieve target user roles
    const allUserRoles = await this.rbacService.getAllUsers();
    const targetRoles = allUserRoles.find((u) => u.id === dto.targetUserId)?.roles || [];

    const organizationId =
      targetTeam?.organizationId?.toString() ||
      ((targetUser as unknown as { organizationId?: { toString(): string } }).organizationId?.toString()) ||
      ((actorUser as unknown as { organizationId?: { toString(): string } }).organizationId?.toString()) ||
      '000000000000000000000001';

    const createdRecord = await this.requestRepo.create({
      organizationId,
      teamId: targetTeam
        ? (targetTeam as unknown as { _id?: { toString(): string } })._id?.toString()
        : undefined,
      teamName: targetTeam ? targetTeam.name : undefined,
      targetUserId: dto.targetUserId,
      targetUserName: targetUser.fullName || targetUser.email,
      targetUserEmail: targetUser.email,
      targetUserRoles: targetRoles,
      requestedById: actorUserId,
      requestedByName: actorUser.fullName || actorUser.email,
      requestedByEmail: actorUser.email,
      transferToUserId: dto.transferToUserId,
      transferToUserName: successorUser
        ? successorUser.fullName || successorUser.email
        : undefined,
      projectTransfers: dto.projectTransfers,
      reason: dto.reason.trim(),
      note: dto.note?.trim(),
      status: 'PENDING',
    });

    await this.audit.append({
      actorUserId,
      action: 'OFFBOARDING_REQUEST_CREATED',
      resourceType: 'OFFBOARDING_REQUEST',
      resourceId: createdRecord.id,
      metadata: {
        targetUserId: dto.targetUserId,
        targetEmail: targetUser.email || '',
        reason: dto.reason || '',
        transferToUserId: dto.transferToUserId || '',
      },
    });

    // Notify Team Leads / Admins of the new request
    try {
      const recipientIds: string[] = [];
      if (targetTeam?.managerIds) {
        for (const mid of targetTeam.managerIds) {
          if (mid !== actorUserId) recipientIds.push(mid);
        }
      }
      if (recipientIds.length > 0) {
        await this.notifications.createForUsers({
          recipientUserIds: recipientIds,
          type: 'OFFBOARDING_APPROVAL_NEEDED',
          title: 'User Offboarding Approval Required',
          message: `Offboarding requested for ${targetUser.fullName || targetUser.email} (${targetTeam?.name || 'Staff'}). Review and approval required.`,
          eventKey: 'OFFBOARDING_APPROVAL_NEEDED',
          resourceType: 'OFFBOARDING_REQUEST',
          resourceId: createdRecord.id,
          link: '/team-lead/offboarding-approvals',
        });
      }
    } catch {
      // Non-blocking notification
    }

    return createdRecord;
  }

  /**
   * UC-89: Retrieve offboarding requests scoped by Team Lead authorization or Platform Admin.
   */
  async listRequests(
    actorUserId: string,
    isPlatformAdmin = false,
    query?: ListOffboardingRequestsQueryDto,
  ): Promise<OffboardingRequestRecord[]> {
    const filter: {
      teamId?: string;
      targetUserId?: string;
      status?: OffboardingRequestStatus;
    } = {};

    if (query?.status) filter.status = query.status;
    if (query?.teamId) filter.teamId = query.teamId;
    if (query?.targetUserId) filter.targetUserId = query.targetUserId;

    if (isPlatformAdmin) {
      return this.requestRepo.findAll(filter);
    }

    // Team Lead scope: find teams managed by actor
    const managedTeams = await this.teamModel
      .find({ managerIds: actorUserId })
      .lean()
      .exec();

    const managedTeamIds = new Set(
      managedTeams.map((t) =>
        (t as unknown as { _id?: { toString(): string } })._id?.toString(),
      ),
    );
    const managedMemberIds = new Set(
      managedTeams.flatMap((t) => t.memberIds || []),
    );

    const allRequests = await this.requestRepo.findAll(filter);

    return allRequests.filter((req) => {
      // Allowed if the request is for a team managed by lead,
      // or target user is a member of a team managed by lead,
      // or request was submitted by this lead
      const inManagedTeam = req.teamId ? managedTeamIds.has(req.teamId) : false;
      const isTargetMember = managedMemberIds.has(req.targetUserId);
      const isRequester = req.requestedById === actorUserId;

      return inManagedTeam || isTargetMember || isRequester;
    });
  }

  /**
   * UC-89: Retrieve full request details with live UC-83 resource impact review.
   */
  async getRequestDetails(
    actorUserId: string,
    requestId: string,
    isPlatformAdmin = false,
  ): Promise<{
    request: OffboardingRequestRecord;
    liveSummary: UserOffboardingSummary | Record<string, unknown>;
    isAuthorizedToReview: boolean;
  }> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'OFFBOARDING_REQUEST_NOT_FOUND',
        message: 'Offboarding request not found',
      });
    }

    const isAuthorized = await this.checkReviewAuthorization(
      actorUserId,
      request,
      isPlatformAdmin,
    );

    if (!isAuthorized && request.requestedById !== actorUserId) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_OFFBOARDING_REQUEST_ACCESS',
        message: 'You are not authorized to view this offboarding request',
      });
    }

    // Call UC-83 to get live resource & security summary
    let liveSummary:
      | (UserOffboardingSummary & { eligibleSuccessors?: unknown[] })
      | Record<string, unknown>;
    try {
      const summary = await this.offboardingService.getOffboardingSummary(
        actorUserId,
        request.targetUserId,
        isPlatformAdmin,
      );
      liveSummary = {
        ...summary,
        eligibleSuccessors: summary.eligibleStaff,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to retrieve live resource summary';
      liveSummary = {
        error: msg,
        activeSessionsCount: 0,
        apiKeysCount: 0,
        assignedProjects: [],
        pendingJobsCount: 0,
        eligibleStaff: [],
        eligibleSuccessors: [],
      };
    }

    return {
      request,
      liveSummary,
      isAuthorizedToReview: isAuthorized,
    };
  }

  /**
   * UC-89: Approve user offboarding request and execute UC-83 offboarding workflow.
   */
  async approveRequest(
    actorUserId: string,
    requestId: string,
    dto: ApproveOffboardingRequestDto,
    isPlatformAdmin = false,
  ): Promise<{
    request: OffboardingRequestRecord;
    executionResult: UserOffboardingResult;
  }> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'OFFBOARDING_REQUEST_NOT_FOUND',
        message: 'Offboarding request not found',
      });
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'OFFBOARDING_REQUEST_NOT_PENDING',
        message: `This offboarding request cannot be approved because its status is ${request.status}`,
      });
    }

    const isAuthorized = await this.checkReviewAuthorization(
      actorUserId,
      request,
      isPlatformAdmin,
    );

    if (!isAuthorized) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_OFFBOARDING_APPROVAL',
        message:
          'You are not authorized to approve offboarding requests for this team member',
      });
    }

    const actorOid = toObjectId(actorUserId);
    const actorUser = await this.userModel.findById(actorOid).lean().exec();
    const actorName = actorUser?.fullName || actorUser?.email || 'Authorized Approver';

    // Determine final transfer plan (dto override takes priority over request's initial plan)
    const effectiveTransferToUserId = dto.transferToUserId || request.transferToUserId;
    const effectiveProjectTransfers =
      dto.projectTransfers && dto.projectTransfers.length > 0
        ? dto.projectTransfers
        : request.projectTransfers;

    // Execute controlled offboarding via UC-83
    const executionResult = await this.offboardingService.executeOffboarding(
      actorUserId,
      request.targetUserId,
      isPlatformAdmin,
      {
        reason: request.reason,
        transferToUserId: effectiveTransferToUserId,
        projectTransfers: effectiveProjectTransfers as unknown as OffboardingProjectTransferItemDto[],
      },
    );

    // Update request state to APPROVED
    const updatedRequest = await this.requestRepo.update(requestId, {
      status: 'APPROVED',
      reviewedById: actorUserId,
      reviewedByName: actorName,
      reviewedAt: new Date(),
      reviewNote: dto.note?.trim(),
      transferToUserId: effectiveTransferToUserId,
      projectTransfers: effectiveProjectTransfers,
      executionResult: executionResult as unknown as Record<string, unknown>,
    });

    await this.audit.append({
      actorUserId,
      action: 'OFFBOARDING_REQUEST_APPROVED',
      resourceType: 'OFFBOARDING_REQUEST',
      resourceId: requestId,
      metadata: {
        targetUserId: request.targetUserId,
        targetEmail: request.targetUserEmail || '',
        approvedBy: actorName,
        note: dto.note || '',
        executionSuccess: String(executionResult.success),
      },
    });

    // Notify requester of approval
    try {
      await this.notifications.createForUsers({
        recipientUserIds: [request.requestedById],
        type: 'OFFBOARDING_REQUEST_APPROVED',
        title: 'Offboarding Request Approved',
        message: `The offboarding request for ${request.targetUserName} has been approved and executed by ${actorName}.`,
        eventKey: 'OFFBOARDING_REQUEST_APPROVED',
        resourceType: 'OFFBOARDING_REQUEST',
        resourceId: requestId,
        link: '/team-lead/offboarding-approvals',
      });
    } catch {
      // Non-blocking notification
    }

    return {
      request: updatedRequest || request,
      executionResult,
    };
  }

  /**
   * UC-89: Reject user offboarding request with mandatory reason.
   */
  async rejectRequest(
    actorUserId: string,
    requestId: string,
    dto: RejectOffboardingRequestDto,
    isPlatformAdmin = false,
  ): Promise<OffboardingRequestRecord> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) {
      throw new NotFoundException({
        code: 'OFFBOARDING_REQUEST_NOT_FOUND',
        message: 'Offboarding request not found',
      });
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'OFFBOARDING_REQUEST_NOT_PENDING',
        message: `This offboarding request cannot be rejected because its status is ${request.status}`,
      });
    }

    if (!dto.rejectionReason || !dto.rejectionReason.trim()) {
      throw new BadRequestException({
        code: 'REJECTION_REASON_REQUIRED',
        message: 'A rejection reason is mandatory when rejecting an offboarding request',
      });
    }

    const isAuthorized = await this.checkReviewAuthorization(
      actorUserId,
      request,
      isPlatformAdmin,
    );

    if (!isAuthorized) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_OFFBOARDING_REJECTION',
        message:
          'You are not authorized to reject offboarding requests for this team member',
      });
    }

    const actorOid = toObjectId(actorUserId);
    const actorUser = await this.userModel.findById(actorOid).lean().exec();
    const actorName = actorUser?.fullName || actorUser?.email || 'Authorized Reviewer';

    const updatedRequest = await this.requestRepo.update(requestId, {
      status: 'REJECTED',
      reviewedById: actorUserId,
      reviewedByName: actorName,
      reviewedAt: new Date(),
      rejectionReason: dto.rejectionReason.trim(),
      reviewNote: dto.note?.trim(),
    });

    await this.audit.append({
      actorUserId,
      action: 'OFFBOARDING_REQUEST_REJECTED',
      resourceType: 'OFFBOARDING_REQUEST',
      resourceId: requestId,
      metadata: {
        targetUserId: request.targetUserId,
        targetEmail: request.targetUserEmail || '',
        rejectedBy: actorName,
        rejectionReason: dto.rejectionReason.trim(),
      },
    });

    // Notify requester of rejection
    try {
      await this.notifications.createForUsers({
        recipientUserIds: [request.requestedById],
        type: 'OFFBOARDING_REQUEST_REJECTED',
        title: 'Offboarding Request Rejected',
        message: `The offboarding request for ${request.targetUserName} was rejected by ${actorName}. Reason: ${dto.rejectionReason}`,
        eventKey: 'OFFBOARDING_REQUEST_REJECTED',
        resourceType: 'OFFBOARDING_REQUEST',
        resourceId: requestId,
        link: '/team-lead/offboarding-approvals',
      });
    } catch {
      // Non-blocking notification
    }

    return updatedRequest || request;
  }

  /**
   * Helper to verify if actor is authorized to review/approve/reject a request.
   */
  private async checkReviewAuthorization(
    actorUserId: string,
    request: OffboardingRequestRecord,
    isPlatformAdmin: boolean,
  ): Promise<boolean> {
    if (isPlatformAdmin) return true;

    // Check if actor is manager of request.teamId or of any team containing targetUserId
    const managedTeams = await this.teamModel
      .find({ managerIds: actorUserId })
      .lean()
      .exec();

    const managesTarget = managedTeams.some(
      (t) =>
        (request.teamId &&
          (t as unknown as { _id?: { toString(): string } })._id?.toString() ===
            request.teamId) ||
        t.memberIds.includes(request.targetUserId),
    );

    return managesTarget;
  }
}
