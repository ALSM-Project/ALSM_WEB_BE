import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/application/auth.service';

const userId = '507f1f77bcf86cd799439011';
const sessionId = '507f1f77bcf86cd799439012';
async function fixture() {
  const proof = { sub: userId, tid: 'original', sid: sessionId, fid: 'family' };
  const jwt = {
    verifyAsync: jest.fn().mockResolvedValue(proof),
    signAsync: jest.fn().mockResolvedValue('prepared-credential'),
  };
  const config = {
    getOrThrow: (key: string) => (key.includes('EXPIRES') ? '15m' : 'fixture-only-key'),
  };
  const users = { findById: jest.fn().mockResolvedValue({ id: userId, isActive: true }) };
  const sessions = {
    findActive: jest.fn().mockResolvedValue({
      id: sessionId,
      userId,
      tokenId: 'original',
      familyId: 'family',
      accessVersion: 'original',
      refreshTokenHash: await bcrypt.hash('proof', 4),
      expiresAt: new Date(Date.now() + 60000),
    }),
    rotateRefresh: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
    revoke: jest.fn(),
    revokeBrowserSession: jest.fn().mockResolvedValue(undefined),
    findForLogout: jest.fn(),
  };
  const service = new AuthService(
    jwt as never,
    config as never,
    users as never,
    {} as never,
    sessions as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { proof, jwt, users, sessions, service };
}

describe('atomic refresh and browser lineage authority', () => {
  it('never publishes a losing CAS or creates a successor document', async () => {
    const f = await fixture();
    f.sessions.rotateRefresh.mockResolvedValue(false);
    await expect(f.service.refresh('proof')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.sessions.rotateRefresh).toHaveBeenCalledTimes(1);
    expect(f.sessions.create).not.toHaveBeenCalled();
    expect(f.sessions.revoke).not.toHaveBeenCalled();
  });
  it('never retries an unconfirmed write or publishes prepared credentials', async () => {
    const f = await fixture();
    f.sessions.rotateRefresh.mockRejectedValue(new Error('private driver failure'));
    await expect(f.service.refresh('proof')).rejects.toMatchObject({
      status: 503,
      response: { code: 'REFRESH_UNAVAILABLE' },
    });
    expect(f.sessions.rotateRefresh).toHaveBeenCalledTimes(1);
    expect(f.sessions.create).not.toHaveBeenCalled();
  });
  it('prepares credentials before consumption so a signing failure does not consume the proof', async () => {
    const f = await fixture();
    f.jwt.signAsync.mockRejectedValue(new Error('signer unavailable'));
    await expect(f.service.refresh('proof')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.sessions.rotateRefresh).not.toHaveBeenCalled();
  });
  it('uses stale signed lineage proof for logout and preserves database failures as 503', async () => {
    const f = await fixture();
    await f.service.logout('proof');
    expect(f.sessions.revokeBrowserSession).toHaveBeenCalledWith({
      userId,
      sessionId,
      familyId: 'family',
    });
    expect(f.sessions.findActive).not.toHaveBeenCalled();
    expect(f.jwt.verifyAsync).toHaveBeenCalledWith(
      'proof',
      expect.objectContaining({ ignoreExpiration: true }),
    );
    f.sessions.revokeBrowserSession.mockRejectedValue(new Error('private storage address'));
    await expect(f.service.logout('proof')).rejects.toMatchObject({
      status: 503,
      response: { code: 'SESSION_REVOCATION_UNAVAILABLE' },
    });
  });
  it('does not grant revocation from malformed or invalidly signed proof', async () => {
    const f = await fixture();
    f.jwt.verifyAsync.mockResolvedValueOnce({ ...f.proof, sid: 'malformed' });
    await f.service.logout('proof');
    f.jwt.verifyAsync.mockRejectedValueOnce(new Error('signature'));
    await f.service.logout('proof');
    expect(f.sessions.revokeBrowserSession).not.toHaveBeenCalled();
  });
});
