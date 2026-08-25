import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import {
  MFA_SECURITY,
  MfaSecurityPort,
} from './mfa-security.port';

export interface StartMfaSetupResult {
  enabled: false;
  otpauthUri: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class StartMfaSetupService {
  constructor(
    private readonly config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MFA_SECURITY) private readonly security: MfaSecurityPort,
  ) {}

  async execute(userId: string): Promise<StartMfaSetupResult> {
    const user = await this.users.findById(userId);
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

    const material = await this.security.createEnrollment({
      issuer: this.config.get<string>('MFA_ISSUER') ?? 'ALSM',
      accountLabel: user.email,
    });
    const updatedUser = await this.users.beginMfaSetup(
      user.id,
      material.encryptedSecret,
    );
    if (!updatedUser) {
      throw new ConflictException({
        code: 'MFA_SETUP_STATE_CHANGED',
        message: 'Two-factor authentication state changed. Please try again.',
      });
    }

    return {
      enabled: false,
      otpauthUri: material.otpauthUri,
      qrCodeDataUrl: material.qrCodeDataUrl,
    };
  }
}
