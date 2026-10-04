import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { RbacService } from '../../rbac/application/rbac.service';

export interface OnboardUserInput {
  email: string;
  fullName: string;
  role: string;
  temporaryPassword: string;
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
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
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
      passwordHash: await bcrypt.hash(input.temporaryPassword, 12),
      fullName: input.fullName.trim(),
      isEmailVerified: true,
      isActive: true,
      mustChangePassword: true,
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

  private async createUserCatchingDuplicate(
    input: Parameters<UserRepository['create']>[0],
  ): Promise<UserRecord> {
    try {
      return await this.users.create(input);
    } catch (err) {
      const code = (err as { code?: number | string })?.code;
      if (code === 11000 || code === '11000' || code === 'E11000') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email is already registered',
        });
      }
      throw err;
    }
  }
}
