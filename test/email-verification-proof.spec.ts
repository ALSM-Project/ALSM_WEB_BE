import { admissionFixture, otherId } from './authentication-admission.fixture';

describe('real email verifier and session issuance', () => {
  it.each(['arbitrary', 'malformed', 'empty', 'expired', 'unrelated', 'valid'])(
    'rejects an already-verified identity with %s proof on every replay without side effects',
    async (kind) => {
      const f = await admissionFixture();
      f.account.isEmailVerified = true;
      if (kind === 'expired') f.record.expiresAt = new Date(0);
      const proof = kind === 'empty' ? '' : kind === 'valid' || kind === 'expired' ? f.code : kind;
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(f.service.verifyEmail(f.account.email, proof)).rejects.toMatchObject({
          status: 400,
          response: { code: 'INVALID_VERIFICATION_CODE' },
        });
      }
      expect(f.proofs.consumeActive).not.toHaveBeenCalled();
      expect(f.users.markEmailVerifiedIfUnverified).not.toHaveBeenCalled();
      expect(f.sessions.create).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
      expect(f.record.consumedAt).toBeUndefined();
    },
  );
  it.each(['code', 'token'])('accepts intended %s proof once and rejects replay', async (kind) => {
    const f = await admissionFixture();
    const result = await f.service.verifyEmail(
      ' ISOLATED@EXAMPLE.INVALID ',
      kind === 'code' ? f.code : f.token,
    );
    expect(result.accessToken).toEqual(expect.any(String));
    expect(f.account.isEmailVerified).toBe(true);
    expect(f.record.consumedAt).toBeInstanceOf(Date);
    await expect(f.service.verifyEmail(f.account.email, f.code)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.rows).toHaveLength(1);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
    expect(f.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_EMAIL_VERIFIED' }),
    );
  });
  it.each(['missing', 'wrong', 'expired', 'consumed', 'revoked', 'cross-account', 'malformed-id'])(
    'rejects %s proof without account mutation, session creation or success audit',
    async (kind) => {
      const f = await admissionFixture();
      let proof = f.code;
      if (kind === 'missing' || kind === 'revoked')
        f.proofs.findLatestActiveByUserId.mockResolvedValue(null);
      if (kind === 'wrong') proof = f.code === '000000' ? '000001' : '000000';
      if (kind === 'expired') f.record.expiresAt = new Date(0);
      if (kind === 'consumed') f.record.consumedAt = new Date();
      if (kind === 'cross-account') f.record.userId = otherId;
      if (kind === 'malformed-id') f.record.id = 'invalid';
      await expect(f.service.verifyEmail(f.account.email, proof)).rejects.toMatchObject({
        status: 400,
      });
      expect(f.account.isEmailVerified).toBe(false);
      expect(f.sessions.create).not.toHaveBeenCalled();
      expect(f.audit.append).not.toHaveBeenCalled();
    },
  );
  it('uses the same error for missing and privileged already-verified identities', async () => {
    const f = await admissionFixture();
    f.account.isEmailVerified = true;
    f.account.isPlatformAdmin = true;
    const observed = await Promise.all([
      f.service.verifyEmail(f.account.email, f.code).catch((e) => e.response),
      f.service.verifyEmail('absent@example.invalid', f.code).catch((e) => e.response),
    ]);
    expect(observed[0]).toEqual(observed[1]);
  });
  it('allows exactly one concurrent consumer of the same proof', async () => {
    const f = await admissionFixture();
    const result = await Promise.allSettled([
      f.service.verifyEmail(f.account.email, f.code),
      f.service.verifyEmail(f.account.email, f.code),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
  });
  it('allows only one account transition even if different active proofs win consumption', async () => {
    const f = await admissionFixture();
    f.proofs.consumeActive.mockResolvedValue(true);
    const result = await Promise.allSettled([
      f.service.verifyEmail(f.account.email, f.code),
      f.service.verifyEmail(f.account.email, f.token),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.rows).toHaveLength(1);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
  });
  it.each(['expiry', 'revocation'])(
    'rechecks %s at conditional consumption after an active snapshot was read',
    async (state) => {
      const f = await admissionFixture();
      f.proofs.findLatestActiveByUserId.mockImplementation(async () => {
        const snapshot = structuredClone(f.record);
        if (state === 'expiry') f.record.expiresAt = new Date(0);
        else f.record.consumedAt = new Date();
        return snapshot;
      });
      await expect(f.service.verifyEmail(f.account.email, f.code)).rejects.toMatchObject({
        status: 400,
      });
      expect(f.users.markEmailVerifiedIfUnverified).not.toHaveBeenCalled();
      expect(f.rows).toHaveLength(0);
    },
  );
  it('retains forced password remediation after legitimate first verification', async () => {
    const f = await admissionFixture();
    f.account.mustChangePassword = true;
    const credentials = await f.service.verifyEmail(f.account.email, f.code);
    expect(credentials.mustChangePassword).toBe(true);
    await expect(
      f.current.execute(f.account.id, f.rows[0].id, f.rows[0].accessVersion),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      f.current.execute(f.account.id, f.rows[0].id, f.rows[0].accessVersion, true),
    ).resolves.toBeUndefined();
  });
  it('delivers new random proof only through the email port, with no proof logging', async () => {
    const f = await admissionFixture();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await f.verifier.sendVerificationEmail(f.account);
      expect(f.email.send).toHaveBeenCalledTimes(1);
      expect(f.proofs.revokeAllForUser).toHaveBeenCalledWith(f.account.id);
      expect(f.proofs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: f.account.id,
          code: expect.stringMatching(/^\d{6}$/),
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it.each([
    'identity',
    'proof-read',
    'consume',
    'transition',
    'session-create',
    'session-finalize',
    'post-read',
  ])('fails closed with sanitized 503 when %s persistence is unavailable', async (kind) => {
    const f = await admissionFixture();
    const failure = new Error('private persistence detail');
    if (kind === 'identity') f.users.findByEmail.mockRejectedValue(failure);
    if (kind === 'proof-read') f.proofs.findLatestActiveByUserId.mockRejectedValue(failure);
    if (kind === 'consume') f.proofs.consumeActive.mockRejectedValue(failure);
    if (kind === 'transition') f.users.markEmailVerifiedIfUnverified.mockRejectedValue(failure);
    if (kind === 'session-create') f.sessions.create.mockRejectedValue(failure);
    if (kind === 'session-finalize') f.sessions.updateTokenHash.mockRejectedValue(failure);
    if (kind === 'post-read') f.users.findById.mockRejectedValue(failure);
    await expect(f.service.verifyEmail(f.account.email, f.code)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.audit.append).not.toHaveBeenCalled();
    expect(f.rows.every((r) => !!r.revokedAt)).toBe(true);
  });
  it.each([
    'locked',
    'inactive',
    'mfa',
    'wrong-transition-identity',
    'transition-lost',
    'email-changed',
  ])('rejects %s account state without issuing a session or success audit', async (kind) => {
    const f = await admissionFixture();
    if (kind === 'locked') f.account.isLocked = true;
    if (kind === 'inactive') f.account.isActive = false;
    if (kind === 'mfa') f.account.mfa.enabled = true;
    if (kind === 'wrong-transition-identity')
      f.users.markEmailVerifiedIfUnverified.mockResolvedValue({
        ...f.account,
        id: otherId,
        isEmailVerified: true,
      });
    if (kind === 'transition-lost') f.users.markEmailVerifiedIfUnverified.mockResolvedValue(null);
    if (kind === 'email-changed')
      f.users.findById.mockResolvedValue({
        ...f.account,
        email: 'changed@example.invalid',
        isEmailVerified: true,
      });
    await expect(f.service.verifyEmail(f.account.email, f.code)).rejects.toMatchObject({
      status: kind === 'email-changed' ? 401 : 400,
    });
    expect(f.rows).toHaveLength(0);
    expect(f.audit.append).not.toHaveBeenCalled();
  });
});
