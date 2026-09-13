import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfirmMfaSetupService } from '../src/modules/auth/application/confirm-mfa-setup.service';
import { StartMfaSetupService } from '../src/modules/auth/application/start-mfa-setup.service';
import {
  MfaState,
  UserRecord,
} from '../src/modules/users/domain/user.repository';

const pendingMfa: MfaState = {
  enabled: false,
  secret: 'v1.encrypted-secret',
  setupFailureCount: 0,
  backupCodeHashes: [],
};

function user(mfa: MfaState = pendingMfa): UserRecord {
  return {
    id: 'user-1',
    email: 'customer@example.com',
    passwordHash: 'password-hash',
    fullName: 'Customer',
    isPlatformAdmin: false,
    isActive: true,
    isEmailVerified: true,
    mfa,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('MFA enrollment application services', () => {
  const users = {
    findById: jest.fn(),
    findByIdForMfa: jest.fn(),
    beginMfaSetup: jest.fn(),
    completeMfaSetup: jest.fn(),
    recordMfaSetupFailure: jest.fn(),
  };
  const security = {
    createEnrollment: jest.fn(),
    verifyEncryptedSecret: jest.fn(),
    createBackupCodes: jest.fn(),
  };
  const config = { get: jest.fn() };
  const start = new StartMfaSetupService(
    config as unknown as ConfigService,
    users as never,
    security as never,
  );
  const confirm = new ConfirmMfaSetupService(users as never, security as never);

  beforeEach(() => {
    jest.clearAllMocks();
    users.findById.mockResolvedValue(user());
    users.findByIdForMfa.mockResolvedValue(user());
  });

  it('starts enrollment with encrypted state, leaves MFA disabled, and returns provisioning data', async () => {
    const plaintextSecret = 'test-only-plaintext-secret';
    security.createEnrollment.mockResolvedValue({
      encryptedSecret: 'v1.ciphertext',
      otpauthUri: 'otpauth://totp/ALSM:customer%40example.com?secret=test-only-plaintext-secret',
      qrCodeDataUrl: 'data:image/png;base64,qr',
    });
    users.beginMfaSetup.mockResolvedValue(user());

    await expect(start.execute('user-1')).resolves.toEqual({
      enabled: false,
      otpauthUri: expect.stringContaining('otpauth://totp/'),
      qrCodeDataUrl: expect.stringContaining('data:image/png'),
    });
    expect(users.beginMfaSetup).toHaveBeenCalledWith('user-1', 'v1.ciphertext');
    expect(users.beginMfaSetup.mock.calls[0][1]).not.toContain(plaintextSecret);
  });

  it('does not allow an already-enabled user to replace MFA enrollment', async () => {
    users.findById.mockResolvedValue(user({ ...pendingMfa, enabled: true }));

    await expect(start.execute('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(security.createEnrollment).not.toHaveBeenCalled();
    expect(users.beginMfaSetup).not.toHaveBeenCalled();
  });

  it('rejects setup when the authenticated user no longer exists', async () => {
    users.findById.mockResolvedValue(null);

    await expect(start.execute('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('enables MFA only after a correct code and stores only backup-code hashes', async () => {
    const plaintextCodes = [
      'Aa0Bb1Cc2D',
      'Ee3Ff4Gg5H',
      'Ii6Jj7Kk8L',
      'Mm9Nn0Oo1P',
      'Qq2Rr3Ss4T',
      'Uu5Vv6Ww7X',
      'Yy8Zz9Aa0B',
      'Cc1Dd2Ee3F',
    ];
    const hashes = plaintextCodes.map((_, index) => `hash-${index}`);
    security.verifyEncryptedSecret.mockResolvedValue(true);
    security.createBackupCodes.mockResolvedValue({ plaintextCodes, hashes });
    users.completeMfaSetup.mockResolvedValue(user({ ...pendingMfa, enabled: true, backupCodeHashes: hashes }));

    await expect(confirm.execute('user-1', '123456')).resolves.toEqual({
      enabled: true,
      backupCodes: plaintextCodes,
    });
    expect(users.completeMfaSetup).toHaveBeenCalledWith(
      'user-1',
      pendingMfa.secret,
      hashes,
    );
    expect(JSON.stringify(users.completeMfaSetup.mock.calls[0][2])).not.toContain(
      plaintextCodes[0],
    );
    expect(plaintextCodes).toHaveLength(8);
    expect(plaintextCodes.every((code) => /^[A-Za-z0-9]{10}$/.test(code))).toBe(true);
  });

  it('increments failed attempts while the enrollment is still active', async () => {
    security.verifyEncryptedSecret.mockResolvedValue(false);
    users.recordMfaSetupFailure.mockResolvedValue({ reset: false });

    await expect(confirm.execute('user-1', '000000')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(users.recordMfaSetupFailure).toHaveBeenCalledWith(
      'user-1',
      pendingMfa.secret,
      5,
    );
    expect(users.completeMfaSetup).not.toHaveBeenCalled();
  });

  it('requires a fresh enrollment after the fifth failed confirmation', async () => {
    security.verifyEncryptedSecret.mockResolvedValue(false);
    users.recordMfaSetupFailure.mockResolvedValue({ reset: true });

    await expect(confirm.execute('user-1', '000000')).rejects.toMatchObject({
      response: { code: 'MFA_SETUP_RESET' },
    });
    expect(users.completeMfaSetup).not.toHaveBeenCalled();

    users.findByIdForMfa.mockResolvedValue(user({ ...pendingMfa, secret: null }));
    await expect(confirm.execute('user-1', '123456')).rejects.toMatchObject({
      response: { code: 'MFA_SETUP_NOT_STARTED' },
    });
    expect(security.verifyEncryptedSecret).toHaveBeenCalledTimes(1);
  });

  it('does not complete enrollment if its pending state changes concurrently', async () => {
    security.verifyEncryptedSecret.mockResolvedValue(true);
    security.createBackupCodes.mockResolvedValue({
      plaintextCodes: ['Aa0Bb1Cc2D'],
      hashes: ['hash'],
    });
    users.completeMfaSetup.mockResolvedValue(null);

    await expect(confirm.execute('user-1', '123456')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
