import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { RbacService } from '../../rbac/application/rbac.service';
import { EMAIL_PORT, EmailPort } from '../../auth/domain/email.port';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepository,
} from '../../auth/domain/password-reset.repository';

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OnboardUserInput {
  email: string;
  fullName: string;
  role: string;
  organizationId?: string;
  actorUserId: string;
}

export interface OnboardedUserResult {
  id: string;
  email: string;
  fullName: string;
  role: string;
  organizationId?: string;
}

@Injectable()
export class OnboardUserService {
  private readonly logger = new Logger(OnboardUserService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResets: PasswordResetRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly rbacService: RbacService,
  ) {}

  async execute(input: OnboardUserInput): Promise<OnboardedUserResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    if (await this.users.findByEmail(normalizedEmail)) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email is already registered',
      });
    }

    // Validate the requested role exists before creating anything.
    const role = await this.rbacService.getRoleById(input.role).catch(() => null);
    if (!role) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: `Role '${input.role}' not found`,
      });
    }

    const user = await this.createUserCatchingDuplicate({
      email: normalizedEmail,
      fullName: input.fullName.trim(),
      isEmailVerified: false,
      isActive: true,
    });

    await this.rbacService.updateUserRoles(user.id, [role.id]);

    const organization = await this.organizationContext.resolve(
      input.actorUserId,
      input.organizationId,
    );
    await this.organizations.addMember(organization.id, {
      userId: user.id,
      role: OrganizationRole.MEMBER,
    });

    await this.sendInviteEmail(user);

    await this.audit.append({
      actorUserId: input.actorUserId,
      organizationId: organization.id,
      action: 'USER_ONBOARDED',
      resourceType: 'USER',
      resourceId: user.id,
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: role.id,
      organizationId: organization.id,
    };
  }

  private async sendInviteEmail(user: UserRecord): Promise<void> {
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(plainToken);
    await this.passwordResets.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    });

    const inviteUrl = this.buildInviteUrl(plainToken);
    this.logger.log(`Invite generated for ${user.email}`);

    await this.email.send({
      to: user.email,
      subject: 'You have been invited to ALSM Platform',
      html:
        `<p>Hi ${this.escape(user.fullName)},</p>` +
        `<p>An administrator has created an account for you on ALSM Platform.</p>` +
        `<p>Click the link below to set your password and activate your account (valid for 7 days):</p>` +
        `<p><a href="${inviteUrl}">${inviteUrl}</a></p>` +
        `<p>If you were not expecting this invitation, you can safely ignore this email.</p>`,
      text: `Hi ${user.fullName}, set your ALSM password here: ${inviteUrl}`,
    });
  }

  private buildInviteUrl(plainToken: string): string {
    const base = this.config.get<string>('APP_BASE_URL') || 'http://localhost:3002';
    return `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(plainToken)}`;
  }

  private createUserCatchingDuplicate(
    input: Parameters<UserRepository['create']>[0],
  ): Promise<UserRecord> {
    return this.users.create(input).catch((err: unknown) => {
      const code = (err as { code?: number | string })?.code;
      if (code === 11000 || code === '11000' || code === 'E11000') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email is already registered',
        });
      }
      throw err;
    });
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c];
    });
  }
}

/** Deterministic hash so the invite link matches the stored hash. */
function hashToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}
