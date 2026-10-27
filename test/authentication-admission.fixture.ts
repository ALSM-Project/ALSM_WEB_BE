import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/application/auth.service';
import { EmailVerificationService } from '../src/modules/auth/application/email-verification.service';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { EmailVerificationRecord } from '../src/modules/auth/domain/email-verification.repository';
import { RefreshRotation, SessionRecord } from '../src/modules/auth/domain/session.repository';
import { UserRecord } from '../src/modules/users/domain/user.repository';

export const userId = '111111111111111111111111';
export const sessionId = '222222222222222222222222';
export const otherId = '333333333333333333333333';

/** Disposable in-memory state only; no AppModule, environment file or external provider. */
export async function admissionFixture() {
  const password = randomUUID();
  const token = randomBytes(32).toString('hex');
  const code = String(randomInt(100000, 1000000));
  const account: UserRecord = {
    id: userId,
    email: 'isolated@example.invalid',
    fullName: 'Isolated fixture',
    passwordHash: await bcrypt.hash(password, 4),
    isPlatformAdmin: false,
    isActive: true,
    isLocked: false,
    isEmailVerified: false,
    mustChangePassword: false,
    mfa: { enabled: false, secret: null, setupFailureCount: 0, backupCodeHashes: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const record: EmailVerificationRecord = {
    id: '444444444444444444444444',
    userId,
    code,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60000),
  };
  const rows: SessionRecord[] = [];
  const users = {
    findByEmail: jest.fn(async (email: string): Promise<UserRecord | null> =>
      email === account.email ? structuredClone(account) : null,
    ),
    findById: jest.fn(async (): Promise<UserRecord | null> => structuredClone(account)),
    markEmailVerifiedIfUnverified: jest.fn(
      async (id: string, email: string): Promise<UserRecord | null> => {
        if (
          id !== account.id ||
          email !== account.email ||
          account.isEmailVerified ||
          !account.isActive ||
          account.isLocked ||
          account.mfa.enabled
        )
          return null;
        account.isEmailVerified = true;
        return structuredClone(account);
      },
    ),
    markEmailVerified: jest.fn(async () => {
      account.isEmailVerified = true;
    }),
  };
  const proofs = {
    findLatestActiveByUserId: jest.fn(async (): Promise<EmailVerificationRecord | null> =>
      structuredClone(record),
    ),
    // Atomic compare/write models the adapter's conditional single-document write.
    consumeActive: jest.fn(
      async (input: Pick<EmailVerificationRecord, 'id' | 'userId' | 'code' | 'tokenHash'>) => {
        if (
          record.id !== input.id ||
          record.userId !== input.userId ||
          record.code !== input.code ||
          record.tokenHash !== input.tokenHash ||
          record.consumedAt ||
          record.expiresAt.getTime() <= Date.now()
        )
          return false;
        record.consumedAt = new Date();
        return true;
      },
    ),
    revokeAllForUser: jest.fn(),
    create: jest.fn(),
  };
  const sessions = {
    create: jest.fn(async (input: Omit<SessionRecord, 'id' | 'revokedAt'>) => {
      const row = { ...input, id: sessionId };
      rows.push(row);
      return structuredClone(row);
    }),
    updateTokenHash: jest.fn(async (id: string, hash: string) => {
      const row = rows.find((r) => r.id === id && !r.revokedAt);
      if (!row) throw new Error('unconfirmed initialization');
      row.refreshTokenHash = hash;
    }),
    revoke: jest.fn(async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.revokedAt = new Date();
    }),
    findActive: jest.fn(async (tid: string): Promise<SessionRecord | null> => {
      const row = rows.find((r) => r.tokenId === tid && !r.revokedAt);
      return row ? structuredClone(row) : null;
    }),
    findActiveByUserId: jest.fn(async () => structuredClone(rows)),
    rotateRefresh: jest.fn(async (input: RefreshRotation) => {
      const row = rows.find(
        (r) =>
          r.id === input.sessionId &&
          r.userId === input.userId &&
          r.tokenId === input.expectedTokenId &&
          r.refreshTokenHash === input.expectedTokenHash &&
          !r.revokedAt &&
          r.expiresAt.getTime() > Date.now(),
      );
      if (!row) return false;
      Object.assign(row, {
        tokenId: input.successorTokenId,
        accessVersion: input.successorTokenId,
        refreshTokenHash: input.successorTokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
      });
      return true;
    }),
  };
  const jwt = new JwtService();
  const accessKey = randomBytes(32).toString('hex'),
    refreshKey = randomBytes(32).toString('hex');
  const config = new ConfigService({
    JWT_ACCESS_SECRET: accessKey,
    JWT_REFRESH_SECRET: refreshKey,
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  });
  const audit = { append: jest.fn() },
    email = { send: jest.fn() };
  const verifier = new EmailVerificationService(config, users as never, email, proofs as never);
  const service = new AuthService(
    jwt,
    config,
    users as never,
    {} as never,
    sessions as never,
    audit,
    { getUserRoles: async () => [], getEffectivePermissions: async () => [] } as never,
    verifier,
  );
  const current = new RequireCurrentSessionService(sessions as never, users as never);
  return {
    account,
    record,
    rows,
    users,
    proofs,
    sessions,
    jwt,
    config,
    audit,
    email,
    verifier,
    service,
    current,
    password,
    token,
    code,
  };
}
