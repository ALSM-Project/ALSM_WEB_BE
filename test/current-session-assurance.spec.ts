import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SessionRepository } from '../src/modules/auth/domain/session.repository';
import { UserRepository } from '../src/modules/users/domain/user.repository';
const userId = '111111111111111111111111',
  sessionId = '222222222222222222222222';
function fixture() {
  const account = { isActive: true, mustChangePassword: false };
  const session = {
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + 60000),
    revokedAt: undefined as Date | undefined,
  };
  const users = { findById: jest.fn().mockResolvedValue(account) };
  const sessions = { findActiveByUserId: jest.fn().mockResolvedValue([session]) };
  const service = new RequireCurrentSessionService(
    sessions as unknown as SessionRepository,
    users as unknown as UserRepository,
  );
  return { account, session, users, sessions, service };
}
describe('ordinary current-session prerequisite, without impersonation admission', () => {
  it('accepts a current persisted session bound to the active account and exposes no session secrets', async () => {
    const f = fixture();
    await expect(f.service.execute(userId, sessionId)).resolves.toBeUndefined();
  });
  it.each([undefined, 'alias', '333333333333333333333333'])(
    'rejects missing, invalid or other-session IDs: %s',
    async (selected) => {
      const f = fixture();
      await expect(f.service.execute(userId, selected)).rejects.toMatchObject({
        response: { code: 'CURRENT_SESSION_REQUIRED' },
      });
    },
  );
  it('rejects revocation and expiration despite a still-valid JWT', async () => {
    const f = fixture();
    f.session.revokedAt = new Date();
    await expect(f.service.execute(userId, sessionId)).rejects.toThrow();
    f.session.revokedAt = undefined;
    f.session.expiresAt = new Date(Date.now() - 1);
    await expect(f.service.execute(userId, sessionId)).rejects.toThrow();
  });
  it('rejects mismatched accounts, deactivated accounts and required password changes', async () => {
    const f = fixture();
    f.session.userId = '333333333333333333333333';
    await expect(f.service.execute(userId, sessionId)).rejects.toThrow();
    f.session.userId = userId;
    f.account.isActive = false;
    await expect(f.service.execute(userId, sessionId)).rejects.toThrow();
    f.account.isActive = true;
    f.account.mustChangePassword = true;
    await expect(f.service.execute(userId, sessionId)).rejects.toThrow();
  });
  it('fails closed if authoritative session storage cannot be read', async () => {
    const f = fixture();
    f.sessions.findActiveByUserId.mockRejectedValue(new Error('private driver error'));
    await expect(f.service.execute(userId, sessionId)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SESSION_ASSURANCE_UNAVAILABLE' },
    });
  });
  it('fails closed without disclosing account-store errors', async () => {
    const f = fixture();
    f.users.findById.mockRejectedValue(new Error('private driver credentials'));
    await expect(f.service.execute(userId, sessionId)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'SESSION_ASSURANCE_UNAVAILABLE',
        message: 'Session state could not be verified',
      },
    });
    expect(f.sessions.findActiveByUserId).not.toHaveBeenCalled();
  });
  it('rejects a missing account and an invalid persisted expiration', async () => {
    const f = fixture();
    f.users.findById.mockResolvedValueOnce(null);
    await expect(f.service.execute(userId, sessionId)).rejects.toMatchObject({ status: 401 });
    f.session.expiresAt = new Date('invalid');
    await expect(f.service.execute(userId, sessionId)).rejects.toMatchObject({ status: 401 });
  });
});
