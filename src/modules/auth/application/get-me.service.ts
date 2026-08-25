import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_REPOSITORY, UserRecord, UserRepository } from '../../users/domain/user.repository';

@Injectable()
export class GetMeService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: { userId: string }): Promise<UserRecord> {
    const user = await this.users.findById(input.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'User is unavailable' });
    }
    return user;
  }
}
