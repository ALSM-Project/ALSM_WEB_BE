import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { OrganizationRole } from '../domain/organization.types';
import { OrganizationContextService } from './organization-context.service';
import { OrganizationAuthorizationService } from './organization-authorization.service';
import {
  OrganizationInvitation,
  OrganizationInvitationDocument,
} from '../infrastructure/organization-invitation.schema';
import { MailService } from '../../../shared/mail/mail.service';

export interface OrgMemberDto {
  id: string;
  name: string;
  email: string;
  role: OrganizationRole;
  status: 'Active' | 'Locked' | 'Disabled';
  joinedDate: string;
  lastActive: string;
  isCurrentUser: boolean;
  avatarUrl?: string;
  lockReason?: string;
}

export interface OrgInvitationDto {
  id: string;
  name: string;
  email: string;
  role: OrganizationRole;
  status: 'Pending' | 'Expired';
  invitedAt: string;
  expiresAt: string;
  token?: string;
}

export interface OrgMembersListResponse {
  organizationId: string;
  organizationName: string;
  members: OrgMemberDto[];
  invitations: OrgInvitationDto[];
  summary: {
    totalMembers: number;
    activeMembers: number;
    pendingInvitations: number;
    lockedAccounts: number;
  };
}

@Injectable()
export class OrganizationMembersService {
  private readonly logger = new Logger(OrganizationMembersService.name);

  constructor(
    private readonly contextService: OrganizationContextService,
    private readonly authService: OrganizationAuthorizationService,
    @InjectModel(OrganizationInvitation.name)
    private readonly invitationModel: Model<OrganizationInvitationDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    @Optional()
    private readonly mailService?: MailService,
  ) {}

  /**
   * List members and pending invitations for the customer organization
   */
  async listMembers(
    userId: string,
    organizationIdHeader?: string,
  ): Promise<OrgMembersListResponse> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);

    const usersCol = this.connection.db!.collection('users');
    const memberUserIds = org.members.map((m) =>
      Types.ObjectId.isValid(m.userId) ? new Types.ObjectId(m.userId) : m.userId,
    );

    const userDocs = await usersCol
      .find({
        $or: [{ _id: { $in: memberUserIds as any } }, { _id: { $in: org.members.map((m) => m.userId.toString()) as any } }],
      })
      .toArray();

    const userMap = new Map<string, any>();
    for (const u of userDocs) {
      userMap.set(u._id.toString(), u);
    }

    const members: OrgMemberDto[] = [];
    let lockedCount = 0;
    let activeCount = 0;

    for (const m of org.members) {
      const uId = m.userId.toString();
      const u = userMap.get(uId);

      const isLocked = u?.isLocked === true || u?.status === 'LOCKED' || u?.status === 'Locked';
      const isDisabled = u?.isActive === false;
      const status: 'Active' | 'Locked' | 'Disabled' = isLocked
        ? 'Locked'
        : isDisabled
        ? 'Disabled'
        : 'Active';

      if (status === 'Locked') lockedCount++;
      if (status === 'Active') activeCount++;

      members.push({
        id: uId,
        name: u?.fullName || u?.name || (u?.email ? u.email.split('@')[0] : 'Member'),
        email: u?.email || 'unknown@alsm.io',
        role: m.role,
        status,
        joinedDate: (m as any).joinedAt
          ? new Date((m as any).joinedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
          : u?.createdAt
          ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
          : 'Jan 10, 2026',
        lastActive: u?.lastLoginAt
          ? new Date(u.lastLoginAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
          : u?.updatedAt
          ? new Date(u.updatedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
          : 'Recently',
        isCurrentUser: uId === userId,
        avatarUrl: u?.avatarUrl,
        lockReason: u?.lockReason,
      });
    }

    // Load pending invitations
    const orgObjId = Types.ObjectId.isValid(org.id) ? new Types.ObjectId(org.id) : null;
    const invDocs = await this.invitationModel
      .find({
        $or: [
          ...(orgObjId ? [{ organizationId: orgObjId }] : []),
          { organizationId: org.id as any },
        ],
        status: 'PENDING',
      })
      .sort({ createdAt: -1 })
      .exec();

    const now = new Date();
    const invitations: OrgInvitationDto[] = invDocs.map((inv) => ({
      id: inv.id || (inv as any)._id?.toString(),
      name: inv.name || inv.email.split('@')[0],
      email: inv.email,
      role: inv.role,
      status: inv.expiresAt < now ? 'Expired' : 'Pending',
      invitedAt: inv.createdAt
        ? new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
        : 'Recently',
      expiresAt: inv.expiresAt
        ? new Date(inv.expiresAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
        : '',
      token: inv.token,
    }));

    return {
      organizationId: org.id,
      organizationName: org.name,
      members,
      invitations,
      summary: {
        totalMembers: members.length,
        activeMembers: activeCount,
        pendingInvitations: invitations.filter((i) => i.status === 'Pending').length,
        lockedAccounts: lockedCount,
      },
    };
  }

  /**
   * Invite a new member to the organization
   */
  async inviteMember(
    userId: string,
    organizationIdHeader: string | undefined,
    input: { email: string; name?: string; role: OrganizationRole },
  ): Promise<OrgInvitationDto> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    const normalizedEmail = (input.email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new BadRequestException('A valid email address is required');
    }

    const validRoles = [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ];
    if (!validRoles.includes(input.role)) {
      throw new BadRequestException(
        `Invalid organization role. Valid roles are: ${validRoles.join(', ')}`,
      );
    }

    // Role escalation protection: Only an OWNER can invite another OWNER
    const callerMember = org.members.find((m) => m.userId.toString() === userId);
    if (input.role === OrganizationRole.OWNER && callerMember?.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException('Only an organization Owner can invite another Owner');
    }

    // Check if user is already a member
    const usersCol = this.connection.db!.collection('users');
    const existingUser = await usersCol.findOne({ email: normalizedEmail });
    if (existingUser) {
      const alreadyMember = org.members.some(
        (m) => m.userId.toString() === existingUser._id.toString(),
      );
      if (alreadyMember) {
        throw new ConflictException('This email is already an active member of the organization');
      }
    }

    const orgObjId = Types.ObjectId.isValid(org.id) ? new Types.ObjectId(org.id) : (org.id as any);
    const callerObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined;

    // Check if already invited
    const existingInvite = await this.invitationModel.findOne({
      organizationId: orgObjId,
      email: normalizedEmail,
      status: 'PENDING',
    });

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    let inviteDoc: OrganizationInvitationDocument;
    if (existingInvite) {
      existingInvite.role = input.role;
      existingInvite.name = input.name || existingInvite.name;
      existingInvite.token = token;
      existingInvite.expiresAt = expiresAt;
      inviteDoc = await existingInvite.save();
    } else {
      inviteDoc = await this.invitationModel.create({
        organizationId: orgObjId,
        email: normalizedEmail,
        name: input.name || normalizedEmail.split('@')[0],
        role: input.role,
        status: 'PENDING',
        token,
        invitedBy: callerObjId,
        expiresAt,
      });
    }

    // Attempt email delivery if mail service is available
    if (this.mailService) {
      try {
        await this.mailService.sendLeadCreatedNotification({
          to: normalizedEmail,
          contactName: input.name || normalizedEmail.split('@')[0],
          companyName: org.name,
        }).catch((err) => {
          this.logger.warn(`Failed to dispatch invite email to ${normalizedEmail}: ${err.message}`);
        });
      } catch (err: any) {
        this.logger.warn(`Failed to dispatch invite email: ${err?.message}`);
      }
    }

    return {
      id: inviteDoc.id || (inviteDoc as any)._id?.toString(),
      name: inviteDoc.name || normalizedEmail.split('@')[0],
      email: inviteDoc.email,
      role: inviteDoc.role,
      status: 'Pending',
      invitedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      expiresAt: new Date(expiresAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      token: inviteDoc.token,
    };
  }

  /**
   * Resend an existing invitation
   */
  async resendInvitation(
    userId: string,
    organizationIdHeader: string | undefined,
    invitationId: string,
  ): Promise<OrgInvitationDto> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    const invite = await this.invitationModel.findOne({
      _id: Types.ObjectId.isValid(invitationId) ? new Types.ObjectId(invitationId) : invitationId,
    });
    if (!invite || invite.status !== 'PENDING') {
      throw new NotFoundException('Pending invitation not found');
    }

    invite.token = randomUUID();
    invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const updated = await invite.save();

    return {
      id: updated.id || (updated as any)._id?.toString(),
      name: updated.name || updated.email.split('@')[0],
      email: updated.email,
      role: updated.role,
      status: 'Pending',
      invitedAt: new Date(updated.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      expiresAt: new Date(updated.expiresAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      token: updated.token,
    };
  }

  /**
   * Cancel/revoke a pending invitation
   */
  async cancelInvitation(
    userId: string,
    organizationIdHeader: string | undefined,
    invitationId: string,
  ): Promise<{ success: boolean }> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    await this.invitationModel.updateOne(
      {
        _id: Types.ObjectId.isValid(invitationId) ? new Types.ObjectId(invitationId) : invitationId,
      },
      { status: 'CANCELLED' },
    );

    return { success: true };
  }

  /**
   * Change a member's role with Owner Protection rules
   */
  async updateMemberRole(
    userId: string,
    organizationIdHeader: string | undefined,
    targetUserId: string,
    newRole: OrganizationRole,
  ): Promise<{ success: boolean; member: OrgMemberDto }> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    const validRoles = [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
      OrganizationRole.VIEWER,
    ];
    if (!validRoles.includes(newRole)) {
      throw new BadRequestException(`Invalid role. Valid roles are: ${validRoles.join(', ')}`);
    }

    const callerMember = org.members.find((m) => m.userId.toString() === userId);
    const targetMember = org.members.find((m) => m.userId.toString() === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Member not found in this organization');
    }

    // Owner protection rule: Cannot demote the last active Owner
    if (targetMember.role === OrganizationRole.OWNER && newRole !== OrganizationRole.OWNER) {
      const ownerCount = org.members.filter((m) => m.role === OrganizationRole.OWNER).length;
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot demote the last active Owner of the organization');
      }
    }

    // Role escalation protection: Only an OWNER can promote someone to OWNER or demote an OWNER
    if (newRole === OrganizationRole.OWNER && callerMember?.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException('Only an organization Owner can promote a member to Owner');
    }
    if (targetMember.role === OrganizationRole.OWNER && callerMember?.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException('Only an organization Owner can change another Owner\'s role');
    }

    // Prevent self-escalation if caller is not an Owner
    if (userId === targetUserId && newRole === OrganizationRole.OWNER && callerMember?.role !== OrganizationRole.OWNER) {
      throw new ForbiddenException('Self-escalation to Owner is forbidden');
    }

    // Update in database
    const orgsCol = this.connection.db!.collection('organizations');
    const orgObjId = Types.ObjectId.isValid(org.id) ? new Types.ObjectId(org.id) : org.id;
    const targetObjId = Types.ObjectId.isValid(targetUserId) ? new Types.ObjectId(targetUserId) : targetUserId;

    await orgsCol.updateOne(
      {
        _id: orgObjId as any,
        $or: [
          { 'members.userId': targetObjId },
          { 'members.userId': targetUserId },
        ],
      },
      {
        $set: { 'members.$.role': newRole },
      },
    );

    const usersCol = this.connection.db!.collection('users');
    const u = await usersCol.findOne({
      $or: [{ _id: targetObjId as any }, { _id: targetUserId as any }],
    });

    return {
      success: true,
      member: {
        id: targetUserId,
        name: u?.fullName || u?.name || 'Member',
        email: u?.email || '',
        role: newRole,
        status: u?.isLocked ? 'Locked' : u?.isActive === false ? 'Disabled' : 'Active',
        joinedDate: 'Jan 10, 2026',
        lastActive: 'Recently',
        isCurrentUser: targetUserId === userId,
      },
    };
  }

  /**
   * Suspend / lock / unlock a member account
   */
  async updateMemberStatus(
    userId: string,
    organizationIdHeader: string | undefined,
    targetUserId: string,
    newStatus: 'Active' | 'Locked' | 'Disabled',
    reason?: string,
  ): Promise<{ success: boolean }> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    const targetMember = org.members.find((m) => m.userId.toString() === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Member not found in this organization');
    }

    // Owner protection rule: Cannot lock or suspend the last active Owner
    if (targetMember.role === OrganizationRole.OWNER && newStatus !== 'Active') {
      const ownerCount = org.members.filter((m) => m.role === OrganizationRole.OWNER).length;
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot suspend or lock the last active Owner of the organization');
      }
    }

    const usersCol = this.connection.db!.collection('users');
    const targetObjId = Types.ObjectId.isValid(targetUserId) ? new Types.ObjectId(targetUserId) : targetUserId;

    if (newStatus === 'Locked') {
      await usersCol.updateOne(
        { $or: [{ _id: targetObjId as any }, { _id: targetUserId as any }] },
        {
          $set: {
            isLocked: true,
            status: 'LOCKED',
            lockReason: reason || 'Administrative lock by organization administrator',
            lockedAt: new Date(),
          },
        },
      );
    } else if (newStatus === 'Disabled') {
      await usersCol.updateOne(
        { $or: [{ _id: targetObjId as any }, { _id: targetUserId as any }] },
        {
          $set: {
            isActive: false,
            status: 'DISABLED',
          },
        },
      );
    } else {
      await usersCol.updateOne(
        { $or: [{ _id: targetObjId as any }, { _id: targetUserId as any }] },
        {
          $set: {
            isLocked: false,
            isActive: true,
            status: 'ACTIVE',
          },
          $unset: { lockReason: '', lockedAt: '' },
        },
      );
    }

    return { success: true };
  }

  /**
   * Remove a member from the organization with Owner Protection
   */
  async removeMember(
    userId: string,
    organizationIdHeader: string | undefined,
    targetUserId: string,
  ): Promise<{ success: boolean }> {
    const org = await this.contextService.resolve(userId, organizationIdHeader);
    this.authService.require(org, userId, [OrganizationRole.OWNER, OrganizationRole.ADMIN]);

    const targetMember = org.members.find((m) => m.userId.toString() === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Member not found in this organization');
    }

    // Owner protection rule: Cannot remove the last active Owner
    if (targetMember.role === OrganizationRole.OWNER) {
      const ownerCount = org.members.filter((m) => m.role === OrganizationRole.OWNER).length;
      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot remove the last active Owner of the organization');
      }
    }

    const orgsCol = this.connection.db!.collection('organizations');
    const orgObjId = Types.ObjectId.isValid(org.id) ? new Types.ObjectId(org.id) : org.id;
    const targetObjId = Types.ObjectId.isValid(targetUserId) ? new Types.ObjectId(targetUserId) : targetUserId;

    await orgsCol.updateOne(
      { _id: orgObjId as any },
      {
        $pull: {
          members: {
            userId: { $in: [targetObjId, targetUserId] },
          } as any,
        },
      },
    );

    return { success: true };
  }
}
