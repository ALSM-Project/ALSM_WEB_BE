export interface MfaState {
  enabled: boolean;
  secret: string | null;
  setupFailureCount: number;
  backupCodeHashes: string[];
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash?: string;
  fullName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  isEmailVerified: boolean;
  mustChangePassword: boolean;
  mfa: MfaState;
  createdAt: Date;
  updatedAt: Date;
}

export interface MfaSetupFailureResult {
  reset: boolean;
}

export interface UserRepository {
  create(
    input: Pick<UserRecord, 'email' | 'passwordHash' | 'fullName'> & {
      isEmailVerified?: boolean;
      isActive?: boolean;
      mustChangePassword?: boolean;
    },
  ): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  updateStatus(id: string, isActive: boolean): Promise<void>;
  clearMustChangePassword(userId: string): Promise<void>;
  findByIdForMfa(id: string): Promise<UserRecord | null>;
  beginMfaSetup(userId: string, encryptedSecret: string): Promise<UserRecord | null>;
  completeMfaSetup(
    userId: string,
    encryptedSecret: string,
    backupCodeHashes: string[],
  ): Promise<UserRecord | null>;
  recordMfaSetupFailure(
    userId: string,
    encryptedSecret: string,
    maxAttempts: number,
  ): Promise<MfaSetupFailureResult | null>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
