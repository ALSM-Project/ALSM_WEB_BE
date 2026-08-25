import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { RegisterUserService } from '../src/modules/auth/application/register-user.service';
import { LoginUserService } from '../src/modules/auth/application/login-user.service';
import { RefreshSessionService } from '../src/modules/auth/application/refresh-session.service';
import { OrganizationType } from '../src/modules/organizations/domain/organization.types';

function makeTokens() {
  return {
    issue: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    verifyRefreshToken: jest.fn(),
  };
}

describe('RegisterUserService', () => {
  const tokens = makeTokens();
  const users = { findByEmail: jest.fn(), create: jest.fn(), findById: jest.fn() };
  const organizations = { create: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new RegisterUserService(
    tokens as never,
    users as never,
    organizations as never,
    audit as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('registers a user, self-service organization, owner membership, and audit event', async () => {
    users.findByEmail.mockResolvedValue(null);
    users.create.mockResolvedValue({
      id: 'u1',
      email: 'a@example.com',
      fullName: 'Ada',
      isPlatformAdmin: false,
      isActive: true,
    });
    organizations.create.mockResolvedValue({ id: 'o1' });

    await service.execute({
      email: 'A@Example.com',
      password: 'a-strong-password',
      fullName: 'Ada',
    });

    expect(organizations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: OrganizationType.SELF_SERVICE,
        members: [{ userId: 'u1', role: 'OWNER' }],
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_REGISTERED' }),
    );
    expect(tokens.issue).toHaveBeenCalled();
  });

  it('rejects a duplicate email', async () => {
    users.findByEmail.mockResolvedValue({ id: 'u1' });
    await expect(
      service.execute({ email: 'a@example.com', password: 'a-strong-password', fullName: 'Ada' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('LoginUserService', () => {
  const tokens = makeTokens();
  const users = { findByEmail: jest.fn(), create: jest.fn(), findById: jest.fn() };
  const audit = { append: jest.fn() };
  const service = new LoginUserService(tokens as never, users as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not authenticate an invalid password', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(
      service.execute({ email: 'a@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RefreshSessionService', () => {
  const tokens = makeTokens();
  const users = { findById: jest.fn() };
  const sessions = { findActive: jest.fn(), revoke: jest.fn() };
  const service = new RefreshSessionService(tokens as never, sessions as never, users as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unknown refresh token', async () => {
    tokens.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN' }),
    );
    await expect(service.execute({ refreshToken: 'bad' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
