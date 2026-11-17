export interface MfaState {
  enabled: boolean;
  secret: string | null;
  setupFailureCount: number;
  backupCodeHashes: string[];
}

/** Identity classification only; it does not grant organization or service access. */
export type UserAccountType = 'STANDARD' | 'PROSPECT';

export interface UserRecord {
  id: string;
  /** Absent on legacy records; never use this field alone to grant permissions. */
  accountType?: UserAccountType;
  email: string;
  passwordHash?: string;
  fullName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  isEmailVerified: boolean;
  mustChangePassword: boolean;
  isLocked: boolean;
  lockReason?: string;
  role?: string;
  roles?: string[];
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
      accountType?: UserAccountType;
      isEmailVerified?: boolean;
      isActive?: boolean;
      mustChangePassword?: boolean;
    },
  ): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  /** Conditional transition after consumed email proof; null means admission lost. */
  markEmailVerifiedIfUnverified(userId: string, email: string): Promise<UserRecord | null>;
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
