import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../organizations/domain/organization.repository';
import { OrganizationRole, OrganizationType } from '../../organizations/domain/organization.types';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { AuthTokenIssuerService } from './auth-token-issuer.service';
import { GOOGLE_IDENTITY_PORT, GoogleIdentityPort } from '../domain/google-identity.port';
import { AuthTokens } from './auth-tokens';

@Injectable()
export class LoginWithGoogleService {
  constructor(
    private readonly tokens: AuthTokenIssuerService,
    @Inject(GOOGLE_IDENTITY_PORT) private readonly google: GoogleIdentityPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: { idToken: string }): Promise<AuthTokens> {
    const identity = await this.google.verifyIdToken(input.idToken);
    const email = identity.email.trim().toLowerCase();

    let user = await this.users.findByEmail(email);

    if (!user) {
      // First sign-in via Google: provision the account without a password.
      user = await this.users.create({ email, fullName: identity.fullName });
      const organization = await this.organizations.create({
        name: `${user.fullName}'s Organization`,
        type: OrganizationType.SELF_SERVICE,
        members: [{ userId: user.id, role: OrganizationRole.OWNER }],
      });
      await this.audit.append({
        actorUserId: user.id,
        organizationId: organization.id,
        action: 'USER_REGISTERED_GOOGLE',
        resourceType: 'USER',
        resourceId: user.id,
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled',
      });
    }

    await this.audit.append({
      actorUserId: user.id,
      action: 'USER_LOGIN_GOOGLE',
      resourceType: 'USER',
      resourceId: user.id,
    });

    return this.tokens.issue(user);
  }
}
