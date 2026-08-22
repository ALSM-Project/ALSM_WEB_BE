import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'crypto';
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import {
  BackupCodeMaterial,
  MfaEnrollmentMaterial,
  MfaSecurityPort,
} from '../application/mfa-security.port';

const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 'v1';
const GCM_IV_LENGTH = 12;
const MFA_BACKUP_CODE_COUNT = 8;
const MFA_BACKUP_CODE_LENGTH = 10;
const BACKUP_CODE_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

@Injectable()
export class MfaSecurityService implements MfaSecurityPort {
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    this.encryptionKey = this.parseEncryptionKey(
      config.getOrThrow<string>('MFA_ENCRYPTION_KEY'),
    );
  }

  async createEnrollment(input: {
    issuer: string;
    accountLabel: string;
  }): Promise<MfaEnrollmentMaterial> {
    try {
      const secret = new OTPAuth.Secret({ size: 20 });
      const totp = new OTPAuth.TOTP({
        issuer: input.issuer,
        label: input.accountLabel,
        secret,
        digits: 6,
        period: 30,
      });
      const otpauthUri = totp.toString();
      return {
        encryptedSecret: this.encrypt(secret.base32),
        otpauthUri,
        qrCodeDataUrl: await QRCode.toDataURL(otpauthUri),
      };
    } catch {
      throw new InternalServerErrorException({
        code: 'MFA_SECRET_ENCRYPTION_FAILED',
        message: 'Unable to start two-factor authentication setup',
      });
    }
  }

  async verifyEncryptedSecret(
    encryptedSecret: string,
    code: string,
  ): Promise<boolean> {
    const secret = this.decrypt(encryptedSecret);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  async createBackupCodes(): Promise<BackupCodeMaterial> {
    const plaintextCodes = Array.from(
      { length: MFA_BACKUP_CODE_COUNT },
      () => this.createBackupCode(),
    );
    return {
      plaintextCodes,
      hashes: await Promise.all(
        plaintextCodes.map((code) => bcrypt.hash(code, 12)),
      ),
    };
  }

  private encrypt(plaintext: string): string {
    try {
      const iv = randomBytes(GCM_IV_LENGTH);
      const cipher = createCipheriv(
        AES_256_GCM_ALGORITHM,
        this.encryptionKey,
        iv,
      );
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      return [
        ENCRYPTION_VERSION,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        authTag.toString('base64url'),
      ].join('.');
    } catch {
      throw new InternalServerErrorException({
        code: 'MFA_SECRET_ENCRYPTION_FAILED',
        message: 'Unable to start two-factor authentication setup',
      });
    }
  }

  private decrypt(payload: string): string {
    try {
      const [version, ivEncoded, ciphertextEncoded, authTagEncoded, ...extra] =
        payload.split('.');
      if (
        version !== ENCRYPTION_VERSION ||
        !ivEncoded ||
        !ciphertextEncoded ||
        !authTagEncoded ||
        extra.length > 0
      ) {
        throw new Error('Invalid encrypted MFA secret format');
      }
      const iv = Buffer.from(ivEncoded, 'base64url');
      const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
      const authTag = Buffer.from(authTagEncoded, 'base64url');
      if (iv.length !== GCM_IV_LENGTH || !ciphertext.length || authTag.length !== 16) {
        throw new Error('Invalid encrypted MFA secret payload');
      }
      const decipher = createDecipheriv(
        AES_256_GCM_ALGORITHM,
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new InternalServerErrorException({
        code: 'MFA_SECRET_DECRYPTION_FAILED',
        message: 'Unable to verify the two-factor authentication code',
      });
    }
  }

  private createBackupCode(): string {
    let code = '';
    for (let index = 0; index < MFA_BACKUP_CODE_LENGTH; index += 1) {
      code += BACKUP_CODE_CHARACTERS[randomInt(BACKUP_CODE_CHARACTERS.length)];
    }
    return code;
  }

  private parseEncryptionKey(value: string): Buffer {
    try {
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) {
        throw new Error('MFA encryption key must be a Base64-encoded 32-byte key');
      }
      return key;
    } catch {
      throw new Error('MFA encryption key must be a Base64-encoded 32-byte key');
    }
  }
}
