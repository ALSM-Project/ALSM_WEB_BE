import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import * as OTPAuth from 'otpauth';
import { MfaSecurityService } from '../src/modules/auth/infrastructure/mfa-security.service';

describe('MfaSecurityService', () => {
  let service: MfaSecurityService;

  beforeEach(() => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue(randomBytes(32).toString('base64')),
    };
    service = new MfaSecurityService(config as unknown as ConfigService);
  });

  it('creates a Google Authenticator-compatible URI and encrypts the persisted secret', async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const material = await service.createEnrollment({
      issuer: 'ALSM',
      accountLabel: 'customer@example.com',
    });
    const uri = new URL(material.otpauthUri);
    const plaintextSecret = uri.searchParams.get('secret');
    const code = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(plaintextSecret!),
    }).generate({ timestamp: now });

    expect(material.otpauthUri).toContain('otpauth://totp/ALSM:customer%40example.com');
    expect(material.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(material.encryptedSecret).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/);
    expect(material.encryptedSecret).not.toContain(plaintextSecret!);
    const secondMaterial = await service.createEnrollment({
      issuer: 'ALSM',
      accountLabel: 'customer@example.com',
    });
    expect(secondMaterial.encryptedSecret).not.toBe(material.encryptedSecret);
    await expect(
      service.verifyEncryptedSecret(material.encryptedSecret, code),
    ).resolves.toBe(true);
    jest.restoreAllMocks();
  });

  it('rejects a tampered encrypted secret without exposing its contents', async () => {
    await expect(
      service.verifyEncryptedSecret('v1.invalid.invalid.invalid', '123456'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('generates eight ten-character alphanumeric codes and hashes every persisted value', async () => {
    const backupCodes = await service.createBackupCodes();

    expect(backupCodes.plaintextCodes).toHaveLength(8);
    expect(backupCodes.hashes).toHaveLength(8);
    expect(
      backupCodes.plaintextCodes.every((code) => /^[A-Za-z0-9]{10}$/.test(code)),
    ).toBe(true);
    expect(backupCodes.hashes).not.toEqual(backupCodes.plaintextCodes);
    await expect(
      bcrypt.compare(backupCodes.plaintextCodes[0], backupCodes.hashes[0]),
    ).resolves.toBe(true);
  });
});
