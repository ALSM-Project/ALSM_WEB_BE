import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USER_REPOSITORY, UserRepository } from '../domain/user.repository';

@Injectable()
export class UpdateUserStatusService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string, isActive: boolean): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    await this.users.updateStatus(userId, isActive);
  }
}
