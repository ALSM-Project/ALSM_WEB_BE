import { OAuth2Client } from 'google-auth-library';
import { LockUserService } from '../src/modules/admin/application/lock-user.service';
import { admissionFixture, otherId, sessionId, userId } from './authentication-admission.fixture';

describe('account admission at every ordinary session boundary', () => {
  it.each(['locked', 'inactive', 'unknown-lock'])(
    'rejects %s password login, Google login, refresh and live session',
    async (state) => {
      const f = await admissionFixture();
      f.account.isEmailVerified = true;
      const credentials = await f.service.login(f.account.email, f.password);
      f.audit.append.mockClear();
      f.sessions.create.mockClear();
      if (state === 'locked') f.account.isLocked = true;
      if (state === 'inactive') f.account.isActive = false;
      if (state === 'unknown-lock') Object.assign(f.account, { isLocked: undefined });
      const google = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({ email: f.account.email, email_verified: true, aud: 'fixture-client' }),
      } as never);
      f.config.set('GOOGLE_CLIENT_ID', 'fixture-client');
      try {
        await expect(f.service.login(f.account.email, f.password)).rejects.toMatchObject({
          status: 401,
        });
        await expect(f.service.loginWithGoogle('synthetic-provider-proof')).rejects.toMatchObject({
          status: 401,
        });
        await expect(f.service.refresh(credentials.refreshToken)).rejects.toMatchObject({
          status: 401,
        });
        await expect(
          f.current.execute(userId, sessionId, f.rows[0].accessVersion),
        ).rejects.toMatchObject({ status: 401 });
        await expect(
          f.current.execute(userId, sessionId, f.rows[0].accessVersion, true),
        ).rejects.toMatchObject({ status: 401 });
        expect(f.sessions.create).not.toHaveBeenCalled();
        expect(f.sessions.rotateRefresh).not.toHaveBeenCalled();
        expect(f.audit.append).not.toHaveBeenCalled();
      } finally {
        google.mockRestore();
      }
    },
  );
  it('preserves active unlocked login, refresh and guarded session; old generation is rejected', async () => {
    const f = await admissionFixture();
    f.account.isEmailVerified = true;
    const login = await f.service.login(f.account.email, f.password);
    const old = f.rows[0].accessVersion;
    await expect(f.current.execute(userId, sessionId, old)).resolves.toBeUndefined();
    const refreshed = await f.service.refresh(login.refreshToken);
    expect(refreshed.accessToken).toEqual(expect.any(String));
    await expect(f.current.execute(userId, sessionId, old)).rejects.toMatchObject({ status: 401 });
    await expect(
      f.current.execute(userId, sessionId, f.rows[0].accessVersion),
    ).resolves.toBeUndefined();
  });
  it('preserves Google verification and forced password remediation without permitting ordinary routes', async () => {
    const f = await admissionFixture();
    f.account.mustChangePassword = true;
    f.config.set('GOOGLE_CLIENT_ID', 'fixture-client');
    const google = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: f.account.email, email_verified: true, aud: 'fixture-client' }),
    } as never);
    try {
      expect(await f.service.loginWithGoogle('synthetic-provider-proof')).toMatchObject({
        mustChangePassword: true,
      });
      await expect(
        f.current.execute(userId, sessionId, f.rows[0].accessVersion),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        f.current.execute(userId, sessionId, f.rows[0].accessVersion, true),
      ).resolves.toBeUndefined();
    } finally {
      google.mockRestore();
    }
  });
  it.each(['initial-read', 'create-after-sweep', 'finalize', 'verification-transition'])(
    'withholds credentials when lock wins at %s and preserves lock workflow audit',
    async (order) => {
      const f = await admissionFixture();
      f.account.isEmailVerified = order !== 'verification-transition';
      const doc = {
        _id: userId,
        id: userId,
        email: f.account.email,
        fullName: f.account.fullName,
        isLocked: false,
        save: jest.fn(async () => {
          f.account.isLocked = true;
        }),
      };
      const sweep = jest.fn(async () => {
        f.rows.forEach((row) => {
          row.revokedAt = new Date();
        });
      });
      const lock = new LockUserService(
        { findById: () => ({ exec: async () => doc }) } as never,
        { updateMany: sweep } as never,
        f.audit,
        f.email,
      );
      const executeLock = () =>
        lock.lock({
          actorUserId: otherId,
          targetUserId: userId,
          reason: 'isolated fixture ordering',
        });
      if (order === 'initial-read') await executeLock();
      if (order === 'create-after-sweep') {
        const create = f.sessions.create.getMockImplementation()!;
        f.sessions.create.mockImplementation(async (input) => {
          await executeLock();
          return create(input);
        });
      }
      if (order === 'finalize') {
        const initialize = f.sessions.updateTokenHash.getMockImplementation()!;
        f.sessions.updateTokenHash.mockImplementation(async (id, hash) => {
          await initialize(id, hash);
          await executeLock();
        });
      }
      if (order === 'verification-transition') {
        const consume = f.proofs.consumeActive.getMockImplementation()!;
        f.proofs.consumeActive.mockImplementation(async (input) => {
          const won = await consume(input);
          await executeLock();
          return won;
        });
      }
      const attempt =
        order === 'verification-transition'
          ? f.service.verifyEmail(f.account.email, f.code)
          : f.service.login(f.account.email, f.password);
      await expect(attempt).rejects.toMatchObject({
        status: order === 'verification-transition' ? 400 : 401,
      });
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(f.audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_ACCOUNT_LOCKED' }),
      );
      expect(f.audit.append).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_EMAIL_VERIFIED' }),
      );
      expect(f.audit.append).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_LOGIN' }),
      );
      expect(f.rows.every((row) => !!row.revokedAt)).toBe(true);
    },
  );
  it.each(['before-rotation', 'after-rotation'])(
    'withholds refresh credentials when a lock is saved %s',
    async (order) => {
      const f = await admissionFixture();
      f.account.isEmailVerified = true;
      const credentials = await f.service.login(f.account.email, f.password);
      const rotate = f.sessions.rotateRefresh.getMockImplementation()!;
      f.sessions.rotateRefresh.mockImplementation(async (input) => {
        if (order === 'before-rotation') {
          f.account.isLocked = true;
          f.rows[0].revokedAt = new Date();
        }
        const won = await rotate(input);
        if (order === 'after-rotation') f.account.isLocked = true;
        return won;
      });
      await expect(f.service.refresh(credentials.refreshToken)).rejects.toMatchObject({
        status: 401,
      });
      expect(f.rows[0].revokedAt).toBeInstanceOf(Date);
      await expect(
        f.current.execute(userId, sessionId, f.rows[0].accessVersion),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it('denies lock changes during live-session lookup', async () => {
    const f = await admissionFixture();
    f.account.isEmailVerified = true;
    await f.service.login(f.account.email, f.password);
    f.sessions.findActiveByUserId.mockImplementation(async () => {
      f.account.isLocked = true;
      return structuredClone(f.rows);
    });
    await expect(
      f.current.execute(userId, sessionId, f.rows[0].accessVersion),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('preserves unlock and legitimate login afterward', async () => {
    const f = await admissionFixture();
    f.account.isEmailVerified = true;
    f.account.isLocked = true;
    const doc = {
      id: userId,
      save: jest.fn(async () => {
        f.account.isLocked = false;
      }),
    };
    const lock = new LockUserService(
      { findById: () => ({ exec: async () => doc }) } as never,
      {} as never,
      f.audit,
      f.email,
    );
    await lock.unlock(otherId, userId);
    await expect(f.service.login(f.account.email, f.password)).resolves.toHaveProperty(
      'accessToken',
    );
    expect(f.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_ACCOUNT_UNLOCKED' }),
    );
  });
  it.each([
    'account-store',
    'session-store',
    'rotation-store',
    'mismatched-account',
    'revoked',
    'expired',
    'malformed-session',
    'malformed-subject',
  ])('fails closed at refresh for %s', async (kind) => {
    const f = await admissionFixture();
    f.account.isEmailVerified = true;
    const credentials = await f.service.login(f.account.email, f.password);
    if (kind === 'account-store') f.users.findById.mockRejectedValue(new Error('private detail'));
    if (kind === 'session-store')
      f.sessions.findActive.mockRejectedValue(new Error('private detail'));
    if (kind === 'rotation-store')
      f.sessions.rotateRefresh.mockRejectedValue(new Error('private detail'));
    if (kind === 'mismatched-account')
      f.users.findById.mockResolvedValue({ ...f.account, id: otherId });
    if (kind === 'revoked') f.rows[0].revokedAt = new Date();
    if (kind === 'expired') f.rows[0].expiresAt = new Date(0);
    if (kind === 'malformed-session') f.rows[0].id = 'invalid';
    if (kind === 'malformed-subject')
      jest.spyOn(f.jwt, 'verifyAsync').mockResolvedValue({ sub: {}, tid: f.rows[0].tokenId });
    await expect(f.service.refresh(credentials.refreshToken)).rejects.toMatchObject({
      status: kind.endsWith('store') ? 503 : 401,
    });
  });
});
