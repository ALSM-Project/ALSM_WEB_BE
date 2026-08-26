import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthController } from '../src/modules/auth/presentation/auth.controller';
import { ConfirmMfaSetupDto } from '../src/modules/auth/presentation/auth.dto';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';

describe('AuthController MFA endpoints', () => {
  const auth = {};
  const startMfaSetup = { execute: jest.fn() };
  const confirmMfaSetup = { execute: jest.fn() };
  const controller = new AuthController(
    auth as never,
    startMfaSetup as never,
    confirmMfaSetup as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('protects setup and confirmation with JWT authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.setupMfa)).toContain(
      JwtAuthGuard,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.confirmMfa)).toContain(
      JwtAuthGuard,
    );
  });

  it('prevents sensitive MFA responses from being cached', () => {
    const expectedHeader = { name: 'Cache-Control', value: 'no-store' };

    expect(Reflect.getMetadata(HEADERS_METADATA, AuthController.prototype.setupMfa)).toContainEqual(
      expectedHeader,
    );
    expect(
      Reflect.getMetadata(HEADERS_METADATA, AuthController.prototype.confirmMfa),
    ).toContainEqual(expectedHeader);
  });

  it('rejects confirmation codes that are not exactly six digits', async () => {
    const dto = plainToInstance(ConfirmMfaSetupDto, { code: '12345a' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('uses only the authenticated user identity for MFA setup and confirmation', async () => {
    startMfaSetup.execute.mockResolvedValue({
      enabled: false,
      otpauthUri: 'otpauth://totp/ALSM:customer',
      qrCodeDataUrl: 'data:image/png;base64,qr',
    });
    confirmMfaSetup.execute.mockResolvedValue({
      enabled: true,
      backupCodes: ['Aa0Bb1Cc2D'],
    });

    await controller.setupMfa({
      userId: 'authenticated-user',
      email: 'customer@example.com',
      isPlatformAdmin: false,
    });
    await controller.confirmMfa(
      {
        userId: 'authenticated-user',
        email: 'customer@example.com',
        isPlatformAdmin: false,
      },
      { code: '123456' },
    );

    expect(startMfaSetup.execute).toHaveBeenCalledWith('authenticated-user');
    expect(confirmMfaSetup.execute).toHaveBeenCalledWith('authenticated-user', '123456');
  });
});
