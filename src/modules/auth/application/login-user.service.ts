import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { AuthTokenIssuerService } from './auth-token-issuer.service';
import { AuthTokens } from './auth-tokens';

@Injectable()
export class LoginUserService {
  constructor(
    private readonly tokens: AuthTokenIssuerService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthTokens> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());
    if (
      !user ||
      !user.isActive ||
      !user.passwordHash ||
      !(await bcrypt.compare(input.password, user.passwordHash))
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    await this.audit.append({
      actorUserId: user.id,
      action: 'USER_LOGIN',
      resourceType: 'USER',
      resourceId: user.id,
    });
    return this.tokens.issue(user);
  }
}
