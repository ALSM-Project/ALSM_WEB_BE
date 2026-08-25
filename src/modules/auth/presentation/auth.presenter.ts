import { AuthTokens } from '../application/auth-tokens';
import { UserRecord } from '../../users/domain/user.repository';

export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthPresenter {
  static tokens(tokens: AuthTokens): AuthTokens {
    return tokens;
  }

  static me(user: UserRecord): MeResponse {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
