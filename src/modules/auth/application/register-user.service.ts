import { ConflictException, Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { AuthTokenIssuerService } from './auth-token-issuer.service';
import { AuthTokens } from './auth-tokens';

@Injectable()
export class RegisterUserService {
  constructor(
    private readonly tokens: AuthTokenIssuerService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: { email: string; password: string; fullName: string }): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email is already registered',
      });
    }

    const user = await this.users.create({
      email,
      passwordHash: await bcrypt.hash(input.password, 12),
      fullName: input.fullName.trim(),
    });

    const organization = await this.organizations.create({
      name: `${user.fullName}'s Organization`,
      type: OrganizationType.SELF_SERVICE,
      members: [{ userId: user.id, role: OrganizationRole.OWNER }],
    });

    await this.audit.append({
      actorUserId: user.id,
      organizationId: organization.id,
      action: 'USER_REGISTERED',
      resourceType: 'USER',
      resourceId: user.id,
    });

    return this.tokens.issue(user);
  }
}
