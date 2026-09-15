import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';

@Injectable()
export class SetPasswordService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string, newPassword: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User is unavailable',
      });
    }

    if (user.passwordHash) {
      throw new ConflictException({
        code: 'PASSWORD_ALREADY_SET',
        message: 'Password is already set. Use change password instead.',
      });
    }

    await this.users.updatePassword(user.id, await bcrypt.hash(newPassword, 12));
  }
}
