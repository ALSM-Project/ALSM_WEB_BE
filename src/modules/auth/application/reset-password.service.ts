import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepository,
} from '../domain/password-reset.repository';

@Injectable()
export class ResetPasswordService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResets: PasswordResetRepository,
  ) {}

  async execute(token: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = await this.passwordResets.findActive(tokenHash);

    if (!reset) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'The reset link is invalid or has expired',
      });
    }

    await this.users.updatePassword(reset.userId, await bcrypt.hash(newPassword, 12));
    // A password setup link sent to a newly invited account also proves
    // ownership of the email address, so activation can complete at setup.
    await this.users.markEmailVerified(reset.userId);
    await this.passwordResets.consume(reset.id);
  }
}
