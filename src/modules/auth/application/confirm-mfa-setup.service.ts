import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  USER_REPOSITORY,
  UserRepository,
} from '../../users/domain/user.repository';
import {
  MFA_SECURITY,
  MfaSecurityPort,
} from './mfa-security.port';

export const MAX_MFA_SETUP_FAILURES = 5;

export interface ConfirmMfaSetupResult {
  enabled: true;
  backupCodes: string[];
}

@Injectable()
export class ConfirmMfaSetupService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MFA_SECURITY) private readonly security: MfaSecurityPort,
  ) {}

  async execute(userId: string, code: string): Promise<ConfirmMfaSetupResult> {
    const user = await this.users.findByIdForMfa(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User is unavailable',
      });
    }
    if (user.mfa.enabled) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: 'Two-factor authentication is already enabled',
      });
    }
    if (!user.mfa.secret) {
      throw new BadRequestException({
        code: 'MFA_SETUP_NOT_STARTED',
        message: 'Two-factor authentication setup has not been started',
      });
    }

    const verified = await this.security.verifyEncryptedSecret(
      user.mfa.secret,
      code,
    );
    if (!verified) {
      const failure = await this.users.recordMfaSetupFailure(
        user.id,
        user.mfa.secret,
        MAX_MFA_SETUP_FAILURES,
      );
      if (!failure) {
        throw new ConflictException({
          code: 'MFA_SETUP_STATE_CHANGED',
          message: 'Two-factor authentication state changed. Please try again.',
        });
      }
      if (failure.reset) {
        throw new BadRequestException({
          code: 'MFA_SETUP_RESET',
          message:
            'Too many invalid verification codes. Start two-factor authentication setup again.',
        });
      }
      throw new BadRequestException({
        code: 'INVALID_MFA_CODE',
        message: 'The verification code is invalid',
      });
    }

    const backupCodes = await this.security.createBackupCodes();
    const updatedUser = await this.users.completeMfaSetup(
      user.id,
      user.mfa.secret,
      backupCodes.hashes,
    );
    if (!updatedUser) {
      throw new ConflictException({
        code: 'MFA_SETUP_STATE_CHANGED',
        message: 'Two-factor authentication state changed. Please try again.',
      });
    }

    return { enabled: true, backupCodes: backupCodes.plaintextCodes };
  }
}
